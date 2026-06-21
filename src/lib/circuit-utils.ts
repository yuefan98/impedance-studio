import type { CircuitValidation } from "./types";

const IMPEDANCE_ELEMENT_PARAMS: Record<string, number> = {
  R: 1,
  C: 1,
  L: 1,
  W: 1,
  Wo: 2,
  Ws: 2,
  CPE: 2,
  La: 2,
  G: 2,
  Gs: 3,
  K: 2,
  Zarc: 3,
  TLMQ: 3,
  T: 4,
};

const NLEIS_EIS_ELEMENT_PARAMS: Record<string, number> = {
  RC: 2,
  TDS: 5,
  TDP: 5,
};

const NLEIS_SECOND_ELEMENT_PARAMS: Record<string, number> = {
  RCn: 3,
  TDSn: 7,
  TDPn: 7,
};

const EIS_ELEMENT_PARAMS = { ...IMPEDANCE_ELEMENT_PARAMS, ...NLEIS_EIS_ELEMENT_PARAMS };
const SECOND_ELEMENT_PARAMS = NLEIS_SECOND_ELEMENT_PARAMS;
const ALL_ELEMENT_PARAMS = { ...EIS_ELEMENT_PARAMS, ...SECOND_ELEMENT_PARAMS };
const EIS_GROUPS = new Set(["p", "s"]);
const SECOND_GROUPS = new Set(["p", "s", "d"]);
const PAIR_PREFIXES: Record<string, string> = { RC: "RCn", TDS: "TDSn", TDP: "TDPn" };

export function validateCircuitPair(
  circuit1: string,
  circuit2: string,
  initialGuess: number[],
  constants: Record<string, number>,
): CircuitValidation {
  const parsed1 = parseCircuit(circuit1, EIS_ELEMENT_PARAMS, EIS_GROUPS, "EIS circuit_1");
  const parsed2 = parseCircuit(circuit2, SECOND_ELEMENT_PARAMS, SECOND_GROUPS, "2nd-NLEIS circuit_2");
  const errors = [...parsed1.errors, ...parsed2.errors];
  const warnings: string[] = [];

  if (!parsed1.elements.length && !parsed2.elements.length) {
    errors.push("At least one EIS or 2nd-NLEIS circuit is required.");
  }
  if (parsed2.elements.length && !circuit2.replace(/\s/g, "").includes("d(")) {
    warnings.push("2nd-NLEIS circuits usually use d(cathode, anode) difference grouping.");
  }
  warnings.push(...pairingWarnings(parsed1.elements, parsed2.elements));

  const names = getCircuitParameterNames(circuit1, circuit2, constants);
  if (initialGuess.length && initialGuess.length !== names.length) {
    warnings.push(
      "Initial guess count does not match the estimated non-constant parameter count. The Python adapter will perform authoritative validation at run time.",
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    elements_1: parsed1.elements,
    elements_2: parsed2.elements,
    estimated_parameters: names.length,
    parameter_names: names,
  };
}

export function getCircuitParameterNames(circuit1 = "", circuit2 = "", constants: Record<string, number> = {}) {
  const elements1 = parseCircuit(circuit1, EIS_ELEMENT_PARAMS, EIS_GROUPS, "EIS circuit_1").elements;
  const elements2 = parseCircuit(circuit2, SECOND_ELEMENT_PARAMS, SECOND_GROUPS, "2nd-NLEIS circuit_2").elements;
  const names: string[] = [];
  const seen = new Set<string>();
  const pairedSecond = new Set<string>();

  elements1.forEach((element) => {
    const pair = matchingSecondElement(element, elements2);
    if (pair) {
      pairedSecond.add(pair);
      pairedParameterNames(element, pair).forEach((name) => appendParameterName(names, seen, name, constants));
      return;
    }
    elementParameterNames(element).forEach((name) => appendParameterName(names, seen, name, constants));
  });

  elements2.forEach((element) => {
    if (pairedSecond.has(element)) return;
    elementParameterNames(element).forEach((name) => appendParameterName(names, seen, name, constants));
  });

  return names;
}

export function inferCircuitSharedParameters(circuit1: string, circuit2: string) {
  const elements1 = parseCircuit(circuit1, EIS_ELEMENT_PARAMS, EIS_GROUPS, "EIS circuit_1").elements;
  const elements2 = parseCircuit(circuit2, SECOND_ELEMENT_PARAMS, SECOND_GROUPS, "2nd-NLEIS circuit_2").elements;
  return elements1.flatMap((element) => {
    const pair = matchingSecondElement(element, elements2);
    if (!pair) return [];
    const count = Math.min(parameterCount(element), parameterCount(pair));
    return Array.from({ length: count }, (_, index) => `${indexedName(element, index, count)} -> ${indexedName(pair, index, count)}`);
  });
}

export function getLegacyCircuitParameterNames(circuit1 = "", circuit2 = "") {
  return [...legacyElements(circuit1), ...legacyElements(circuit2)].flatMap((element) => elementParameterNames(element));
}

type CircuitParse = {
  elements: string[];
  errors: string[];
};

function parseCircuit(
  circuit: string,
  allowedElements: Record<string, number>,
  allowedGroups: Set<string>,
  label: string,
): CircuitParse {
  const parser = new CircuitParser(circuit, allowedElements, allowedGroups, label);
  return parser.parse();
}

function legacyElements(circuit: string) {
  return circuit
    .replace(/\s/g, "")
    .match(/[A-Za-z]+_?\d*/g)
    ?.filter((token) => !["p", "d", "s"].includes(token)) ?? [];
}

class CircuitParser {
  private readonly text: string;
  private index = 0;
  private readonly elements: string[] = [];
  private readonly errors: string[] = [];

  constructor(
    circuit: string,
    private readonly allowedElements: Record<string, number>,
    private readonly allowedGroups: Set<string>,
    private readonly label: string,
  ) {
    this.text = circuit.replace(/\s/g, "");
  }

  parse(): CircuitParse {
    if (!this.text) return { elements: [], errors: [] };
    this.parseSequence(new Set());
    if (this.index < this.text.length) {
      this.addError(`Unexpected character '${this.text[this.index]}' at position ${this.index + 1}.`);
    }
    return { elements: this.elements, errors: this.errors };
  }

  private parseSequence(stopChars: Set<string>) {
    let count = 0;
    let expectTerm = true;
    while (this.index < this.text.length) {
      const char = this.text[this.index];
      if (stopChars.has(char)) break;
      if (char === "-") {
        if (expectTerm) this.addError(`Unexpected series separator '-' at position ${this.index + 1}.`);
        this.index += 1;
        expectTerm = true;
        continue;
      }
      if (char === ",") break;
      if (!expectTerm) {
        this.addError(`Missing '-' separator before position ${this.index + 1}.`);
        this.skipUntil(new Set([...stopChars, "-", ","]));
        continue;
      }
      if (!this.parseTerm()) {
        this.skipUntil(new Set([...stopChars, "-", ","]));
      }
      count += 1;
      expectTerm = false;
    }
    if (expectTerm && count > 0) this.addError(`${this.label} cannot end with a series separator.`);
    return count;
  }

  private parseTerm() {
    if (!this.currentIsAlpha()) {
      this.addError(`Expected an element or group at position ${this.index + 1}.`);
      return false;
    }
    const nameStart = this.index;
    const name = this.readAlphaName();
    if (this.peek() === "(") return this.parseGroup(name, nameStart);

    const token = this.readElementSuffix(name);
    const prefix = elementPrefix(token, this.allowedElements);
    if (!prefix) {
      this.addError(
        `${token} is not valid in ${this.label}. Allowed elements: ${Object.keys(this.allowedElements).sort().join(", ")}.`,
      );
      return false;
    }
    this.elements.push(token);
    return true;
  }

  private parseGroup(group: string, nameStart: number) {
    if (!this.allowedGroups.has(group)) {
      this.addError(`${group}(...) is not valid in ${this.label}. Allowed groups: ${Array.from(this.allowedGroups).sort().join(", ")}.`);
    }
    this.index += 1;
    let itemCount = 0;
    let expectItem = true;
    while (this.index < this.text.length) {
      if (this.peek() === ")") {
        if (expectItem) this.addError(`${group}(...) has an empty item at position ${this.index + 1}.`);
        this.index += 1;
        this.validateGroupArity(group, itemCount, nameStart);
        return true;
      }
      if (!expectItem) {
        this.addError(`Expected ',' before position ${this.index + 1} in ${group}(...).`);
        this.skipUntil(new Set([",", ")"]));
      }
      itemCount += this.parseSequence(new Set([",", ")"]));
      if (this.peek() === ",") {
        this.index += 1;
        expectItem = true;
      } else {
        expectItem = false;
      }
    }
    this.addError(`${group}(...) opened at position ${nameStart + 1} is missing a closing ')'.`);
    return false;
  }

  private validateGroupArity(group: string, itemCount: number, nameStart: number) {
    if (group === "d" && itemCount !== 2) {
      this.addError(`d(...) in ${this.label} expects exactly two branches.`);
    } else if ((group === "p" || group === "s") && itemCount < 2) {
      this.addError(`${group}(...) in ${this.label} expects at least two branches.`);
    } else if (!this.allowedGroups.has(group)) {
      this.addError(`${group}(...) opened at position ${nameStart + 1} is not supported here.`);
    }
  }

  private readAlphaName() {
    const start = this.index;
    while (this.index < this.text.length && /[A-Za-z]/.test(this.text[this.index])) this.index += 1;
    return this.text.slice(start, this.index);
  }

  private readElementSuffix(name: string) {
    const start = this.index - name.length;
    if (this.peek() === "_") {
      this.index += 1;
      const digitStart = this.index;
      while (this.index < this.text.length && /\d/.test(this.text[this.index])) this.index += 1;
      if (this.index === digitStart) this.addError(`Element ${name}_ in ${this.label} must include digits after '_'.`);
    } else {
      while (this.index < this.text.length && /\d/.test(this.text[this.index])) this.index += 1;
    }
    return this.text.slice(start, this.index);
  }

  private currentIsAlpha() {
    return this.index < this.text.length && /[A-Za-z]/.test(this.text[this.index]);
  }

  private peek() {
    return this.text[this.index] ?? "";
  }

  private skipUntil(stopChars: Set<string>) {
    while (this.index < this.text.length && !stopChars.has(this.text[this.index])) this.index += 1;
  }

  private addError(message: string) {
    if (!this.errors.includes(message)) this.errors.push(message);
  }
}

function appendParameterName(names: string[], seen: Set<string>, name: string, constants: Record<string, number>) {
  const parts = name.split("/").map((part) => part.trim());
  if (parts.some((part) => part in constants) || seen.has(name)) return;
  seen.add(name);
  names.push(name);
}

function pairedParameterNames(element1: string, element2: string) {
  const count1 = parameterCount(element1);
  const count2 = parameterCount(element2);
  return Array.from({ length: Math.max(count1, count2) }, (_, index) => {
    if (index < count1 && index < count2) {
      return `${indexedName(element1, index, count1)} / ${indexedName(element2, index, count2)}`;
    }
    return index < count1 ? indexedName(element1, index, count1) : indexedName(element2, index, count2);
  });
}

function elementParameterNames(element: string) {
  const count = parameterCount(element);
  return Array.from({ length: count }, (_, index) => indexedName(element, index, count));
}

function indexedName(element: string, index: number, count: number) {
  return count === 1 ? element : `${element}_${index}`;
}

function parameterCount(element: string) {
  const prefix = elementPrefix(element, ALL_ELEMENT_PARAMS);
  return prefix ? ALL_ELEMENT_PARAMS[prefix] : 1;
}

function matchingSecondElement(element: string, elements2: string[]) {
  const parts = elementParts(element, EIS_ELEMENT_PARAMS);
  if (!parts) return null;
  const [prefix, suffix] = parts;
  const secondPrefix = PAIR_PREFIXES[prefix];
  if (!secondPrefix) return null;
  return elements2.find((candidate) => {
    const candidateParts = elementParts(candidate, SECOND_ELEMENT_PARAMS);
    return candidateParts?.[0] === secondPrefix && candidateParts[1] === suffix;
  }) ?? null;
}

function pairingWarnings(elements1: string[], elements2: string[]) {
  const paired = new Set(elements1.map((element) => matchingSecondElement(element, elements2)).filter(Boolean));
  return elements2.flatMap((element) => (paired.has(element) ? [] : [`${element} has no obvious paired EIS element in circuit_1.`]));
}

function elementParts(element: string, allowedElements: Record<string, number>): [string, string] | null {
  const prefix = elementPrefix(element, allowedElements);
  return prefix ? [prefix, element.slice(prefix.length)] : null;
}

function elementPrefix(element: string, allowedElements: Record<string, number>) {
  return Object.keys(allowedElements)
    .sort((a, b) => b.length - a.length)
    .find((prefix) => {
      if (!element.startsWith(prefix)) return false;
      const suffix = element.slice(prefix.length);
      return !suffix || /^\d+$/.test(suffix) || /^_\d+$/.test(suffix);
    });
}
