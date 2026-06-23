from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional


IMPEDANCE_ELEMENT_PARAMS = {
    "R": 1,
    "C": 1,
    "L": 1,
    "W": 1,
    "Wo": 2,
    "Ws": 2,
    "CPE": 2,
    "La": 2,
    "G": 2,
    "Gs": 3,
    "K": 2,
    "Zarc": 3,
    "TLMQ": 3,
    "T": 4,
}

NLEIS_EIS_ELEMENT_PARAMS = {
    "RC": 2,
    "RCD": 4,
    "RCS": 4,
    "TP": 3,
    "TDS": 5,
    "TDP": 5,
    "TDC": 5,
    "TLM": 6,
    "TLMS": 8,
    "TLMD": 8,
}

NLEIS_SECOND_ELEMENT_PARAMS = {
    "RCn": 3,
    "RCDn": 6,
    "RCSn": 6,
    "TPn": 4,
    "TDSn": 7,
    "TDPn": 7,
    "TDCn": 7,
    "TLMn": 8,
    "TLMSn": 11,
    "TLMDn": 11,
}

EIS_ELEMENT_PARAMS = IMPEDANCE_ELEMENT_PARAMS | NLEIS_EIS_ELEMENT_PARAMS
SECOND_ELEMENT_PARAMS = NLEIS_SECOND_ELEMENT_PARAMS
ALL_ELEMENT_PARAMS = EIS_ELEMENT_PARAMS | SECOND_ELEMENT_PARAMS

EIS_GROUPS = {"p", "s"}
SECOND_GROUPS = {"p", "s", "d"}
PAIR_PREFIXES = {
    "RC": "RCn",
    "RCD": "RCDn",
    "RCS": "RCSn",
    "TP": "TPn",
    "TDS": "TDSn",
    "TDP": "TDPn",
    "TDC": "TDCn",
    "TLM": "TLMn",
    "TLMS": "TLMSn",
    "TLMD": "TLMDn",
}


def extract_elements(circuit: str) -> list[str]:
    """Extract valid impedance/nleis element tokens from a circuit string."""
    return _parse_circuit(circuit, ALL_ELEMENT_PARAMS, EIS_GROUPS | SECOND_GROUPS, "circuit").elements


def validate_circuit_pair(
    circuit_1: str,
    circuit_2: str,
    initial_guess: list[float],
    constants: Optional[dict[str, float]] = None,
) -> dict[str, Any]:
    constants = constants or {}
    parsed_1 = _parse_circuit(circuit_1, EIS_ELEMENT_PARAMS, EIS_GROUPS, "EIS circuit_1")
    parsed_2 = _parse_circuit(circuit_2, SECOND_ELEMENT_PARAMS, SECOND_GROUPS, "2nd-NLEIS circuit_2")
    elements_1 = parsed_1.elements
    elements_2 = parsed_2.elements
    errors = [*parsed_1.errors, *parsed_2.errors]
    warnings: list[str] = []

    if not elements_1:
        errors.append("EIS circuit_1 is required for an EISandNLEIS fit.")
    if not elements_2:
        errors.append("2nd-NLEIS circuit_2 is required for an EISandNLEIS fit.")
    if elements_2 and "d(" not in circuit_2.replace(" ", ""):
        warnings.append("2nd-NLEIS circuits usually use d(cathode, anode) difference grouping.")

    errors.extend(_pairing_errors(elements_1, elements_2))

    parameter_names = _parameter_names(elements_1, elements_2, constants)
    if initial_guess and len(initial_guess) != len(parameter_names):
        warnings.append(
            "Initial guess count does not match the estimated non-constant parameter count. "
            "The Python adapter will perform authoritative validation at run time."
        )

    return {
        "valid": not errors,
        "errors": errors,
        "warnings": warnings,
        "elements_1": elements_1,
        "elements_2": elements_2,
        "estimated_parameters": len(parameter_names),
        "parameter_names": parameter_names,
    }


@dataclass
class CircuitParse:
    elements: list[str]
    errors: list[str]


class CircuitParser:
    def __init__(
        self,
        circuit: str,
        allowed_elements: dict[str, int],
        allowed_groups: set[str],
        label: str,
    ):
        self.text = "".join(circuit.split())
        self.allowed_elements = allowed_elements
        self.allowed_groups = allowed_groups
        self.label = label
        self.index = 0
        self.elements: list[str] = []
        self.errors: list[str] = []

    def parse(self) -> CircuitParse:
        if not self.text:
            return CircuitParse([], [])
        self._parse_sequence(stop_chars=set())
        if self.index < len(self.text):
            self._error(f"Unexpected character '{self.text[self.index]}' at position {self.index + 1}.")
        return CircuitParse(self.elements, self.errors)

    def _parse_sequence(self, stop_chars: set[str]) -> int:
        count = 0
        expect_term = True
        while self.index < len(self.text):
            char = self.text[self.index]
            if char in stop_chars:
                break
            if char == "-":
                if expect_term:
                    self._error(f"Unexpected series separator '-' at position {self.index + 1}.")
                self.index += 1
                expect_term = True
                continue
            if char == ",":
                break
            if not expect_term:
                self._error(f"Missing '-' separator before position {self.index + 1}.")
                self._skip_until(stop_chars | {"-", ","})
                continue
            if not self._parse_term():
                self._skip_until(stop_chars | {"-", ","})
            count += 1
            expect_term = False
        if expect_term and count > 0:
            self._error(f"{self.label} cannot end with a series separator.")
        return count

    def _parse_term(self) -> bool:
        if not self._current_is_alpha():
            self._error(f"Expected an element or group at position {self.index + 1}.")
            return False

        name_start = self.index
        name = self._read_alpha_name()
        if self._peek() == "(":
            return self._parse_group(name, name_start)

        token = self._read_element_suffix(name)
        prefix = _element_prefix(token, self.allowed_elements)
        if prefix is None:
            self._error(
                f"{token} is not valid in {self.label}. "
                f"Allowed elements: {', '.join(sorted(self.allowed_elements))}."
            )
            return False
        self.elements.append(token)
        return True

    def _parse_group(self, group: str, name_start: int) -> bool:
        if group not in self.allowed_groups:
            self._error(
                f"{group}(...) is not valid in {self.label}. "
                f"Allowed groups: {', '.join(sorted(self.allowed_groups))}."
            )
        self.index += 1
        item_count = 0
        expect_item = True
        while self.index < len(self.text):
            if self._peek() == ")":
                if expect_item:
                    self._error(f"{group}(...) has an empty item at position {self.index + 1}.")
                self.index += 1
                self._validate_group_arity(group, item_count, name_start)
                return True
            if not expect_item:
                self._error(f"Expected ',' before position {self.index + 1} in {group}(...).")
                self._skip_until({",", ")"})
            item_count += self._parse_sequence(stop_chars={",", ")"})
            if self._peek() == ",":
                self.index += 1
                expect_item = True
            else:
                expect_item = False
        self._error(f"{group}(...) opened at position {name_start + 1} is missing a closing ')'.")
        return False

    def _validate_group_arity(self, group: str, item_count: int, name_start: int) -> None:
        if group == "d" and item_count != 2:
            self._error(f"d(...) in {self.label} expects exactly two branches.")
        elif group in {"p", "s"} and item_count < 2:
            self._error(f"{group}(...) in {self.label} expects at least two branches.")
        elif group not in self.allowed_groups:
            self._error(f"{group}(...) opened at position {name_start + 1} is not supported here.")

    def _read_alpha_name(self) -> str:
        start = self.index
        while self.index < len(self.text) and self.text[self.index].isalpha():
            self.index += 1
        return self.text[start : self.index]

    def _read_element_suffix(self, name: str) -> str:
        start = self.index - len(name)
        if self._peek() == "_":
            self.index += 1
            digit_start = self.index
            while self.index < len(self.text) and self.text[self.index].isdigit():
                self.index += 1
            if self.index == digit_start:
                self._error(f"Element {name}_ in {self.label} must include digits after '_'.")
        else:
            while self.index < len(self.text) and self.text[self.index].isdigit():
                self.index += 1
        return self.text[start : self.index]

    def _current_is_alpha(self) -> bool:
        return self.index < len(self.text) and self.text[self.index].isalpha()

    def _peek(self) -> str:
        return self.text[self.index] if self.index < len(self.text) else ""

    def _skip_until(self, stop_chars: set[str]) -> None:
        while self.index < len(self.text) and self.text[self.index] not in stop_chars:
            self.index += 1

    def _error(self, message: str) -> None:
        if message not in self.errors:
            self.errors.append(message)


def _parse_circuit(
    circuit: str,
    allowed_elements: dict[str, int],
    allowed_groups: set[str],
    label: str,
) -> CircuitParse:
    return CircuitParser(circuit, allowed_elements, allowed_groups, label).parse()


def _parameter_names(
    elements_1: list[str],
    elements_2: list[str],
    constants: dict[str, float],
) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    paired_second: set[str] = set()

    for element in elements_1:
        pair = _matching_second_element(element, elements_2)
        if pair:
            paired_second.add(pair)
            for name in _paired_parameter_names(element, pair):
                _append_parameter_name(names, seen, name, constants)
        else:
            for name in _element_parameter_names(element):
                _append_parameter_name(names, seen, name, constants)

    for element in elements_2:
        if element in paired_second:
            continue
        for name in _element_parameter_names(element):
            _append_parameter_name(names, seen, name, constants)

    return names


def _append_parameter_name(
    names: list[str],
    seen: set[str],
    name: str,
    constants: dict[str, float],
) -> None:
    parts = [part.strip() for part in name.split("/")]
    if any(part in constants for part in parts) or name in seen:
        return
    seen.add(name)
    names.append(name)


def _paired_parameter_names(element_1: str, element_2: str) -> list[str]:
    count_1 = _parameter_count(element_1)
    count_2 = _parameter_count(element_2)
    names: list[str] = []
    for index in range(max(count_1, count_2)):
        if index < count_1 and index < count_2:
            names.append(f"{_indexed_name(element_1, index, count_1)} / {_indexed_name(element_2, index, count_2)}")
        elif index < count_1:
            names.append(_indexed_name(element_1, index, count_1))
        else:
            names.append(_indexed_name(element_2, index, count_2))
    return names


def _element_parameter_names(element: str) -> list[str]:
    count = _parameter_count(element)
    return [_indexed_name(element, index, count) for index in range(count)]


def _indexed_name(element: str, index: int, count: int) -> str:
    return element if count == 1 else f"{element}_{index}"


def _parameter_count(element: str) -> int:
    prefix = _element_prefix(element, ALL_ELEMENT_PARAMS)
    if prefix is None:
        return 1
    return ALL_ELEMENT_PARAMS[prefix]


def _matching_second_element(element: str, elements_2: list[str]) -> str | None:
    parts = _element_parts(element, EIS_ELEMENT_PARAMS)
    if not parts:
        return None
    prefix, suffix = parts
    second_prefix = PAIR_PREFIXES.get(prefix)
    if not second_prefix:
        return None
    for candidate in elements_2:
        candidate_parts = _element_parts(candidate, SECOND_ELEMENT_PARAMS)
        if candidate_parts == (second_prefix, suffix):
            return candidate
    return None


def _pairing_errors(elements_1: list[str], elements_2: list[str]) -> list[str]:
    errors: list[str] = []
    paired = {match for element in elements_1 if (match := _matching_second_element(element, elements_2))}
    for element in elements_2:
        if element not in paired:
            errors.append(
                f"{element} requires its matching linear element in EIS circuit_1 for an EISandNLEIS fit."
            )
    return errors


def _element_parts(element: str, allowed_elements: dict[str, int]) -> tuple[str, str] | None:
    prefix = _element_prefix(element, allowed_elements)
    if prefix is None:
        return None
    return prefix, element[len(prefix) :]


def _element_prefix(element: str, allowed_elements: dict[str, int]) -> str | None:
    for prefix in sorted(allowed_elements, key=len, reverse=True):
        if not element.startswith(prefix):
            continue
        suffix = element[len(prefix) :]
        if not suffix or suffix.isdigit() or (suffix.startswith("_") and suffix[1:].isdigit()):
            return prefix
    return None
