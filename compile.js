const { parse } = require('./pegm');

function* enumerate(iterable) {
  let index = 0;
  for (let item of iterable) {
    yield [index, item];
    index++;
  }
}

function formatWriter(writer) {
  let context = { indents: [], output: [], startOfLine: true };

  formatInstructions(writer, context);

  return context.output.join('');
}

function formatInstructions(writer, context) {
  for (let instruction of writer.write()) {
    formatInstruction(instruction, context);
  }
}

function formatInstruction(instruction, context) {
  if (instruction.type === 'write' || instruction.type === 'writeLine') {
    if (context.startOfLine) {
      if (context.indents.length > 0) {
        context.output.push(context.indents[context.indents.length - 1]);
      }
      context.startOfLine = false;
    }

    context.output.push(instruction.content ?? '');

    if (instruction.type === 'writeLine') {
      context.output.push('\n');
      context.startOfLine = true;
    }
  } else if (instruction.type === 'indent') {
    let previousIndent = context.indents.length > 0 ? context.indents[context.indents.length - 1] : '';
    let newIndent = previousIndent + instruction.content;
    context.indents.push(newIndent);
  } else if (instruction.type === 'setIndent') {
    context.indents.push(instruction.content);
  } else if (instruction.type === 'dedent') {
    context.indents.pop();
  } else if (instruction.type === 'format') {
    formatInstructions(instruction.content, context);
  } else {
    throw new Error(`Unknown instruction type: ${instruction.type}`);
  }
}

function createFunction({ name } = {}) {
  let createdFunction = new FunctionWriter();
  if (name) createdFunction.name = name;
  return createdFunction;
}

function parseFunction(fn) {
  let fnString = fn.toString();
  // TODO assuming function declaration on first line
  let lines = fnString.split('\n');
  let bodyLines = lines.slice(1);
  let indentCandidate = bodyLines[bodyLines.length - 1].match(/^(\s*)/)[1];
  for (let line of bodyLines) {
    let indentMatch = line.startsWith(indentCandidate)
    if (!indentMatch) {
      let matchingIndex = 0;
      while (matchingIndex < indentCandidate.length && line[matchingIndex] === indentCandidate[matchingIndex]) {
        matchingIndex++;
      }
      indentCandidate = indentCandidate.slice(0, matchingIndex);
    }
  }
  bodyLines = [lines[0], ...bodyLines.map(line => line.slice(indentCandidate.length))];
  let code = new CodeWriter();
  code.asReference = new Identifier(fn.name);
  for (let line of bodyLines) {
    code.addLine`${line}`;
  }
  return code;
}

function isWritable(value) {
  return value && typeof value.write === 'function';
}

class CodeWriter {
  constructor() {
    this.instructions = [];
  }

  add(code, ...args) {
    for (let i = 0; i < code.length; i++) {
      this.instructions.push({ type: 'write', content: code[i] });
      if (i < args.length) {
        if (typeof args[i] === 'string') {
          this.instructions.push({ type: 'write', content: args[i] });
        } else if (isWritable(args[i])) {
          this.instructions.push({ type: 'format', content: args[i] });
        } else {
          throw new Error(`Unknown argument type: ${args[i]}`);
        }
      }
    }
  }

  addLine(code, ...args) {
    this.add(code, ...args);
    this.instructions.push({ type: 'writeLine', content: '' });
  }

  indent(additionalIndentation = '  ') {
    this.instructions.push({ type: 'indent', content: additionalIndentation })
  }

  dedent() {
    this.instructions.push({ type: 'dedent' });
  }

  *write() {
    yield* this.instructions;
  }
}

class FunctionWriter extends CodeWriter {
  constructor() {
    super();
    this.name = null
    this.parameters = [];
    this.variables = [];
  }

  getNameNotInUse(requestedName) {
    let inUseNames = new Set([...this.parameters, ...this.variables.map(v => v.name)]);
    let name = requestedName;
    let suffix = 1;
    while (inUseNames.has(name)) {
      name = `${requestedName}_${suffix++}`;
    }
    return name;
  }

  parameter(requestedName) {
    let name = this.getNameNotInUse(requestedName);
    this.parameters.push(name);
    return new Identifier(name);
  }

  variable(requestedName) {
    let name = this.getNameNotInUse(requestedName);
    this.variables.push({ name });
    return new Identifier(name);
  }

  *write() {
    yield { type: 'writeLine', content: `function ${this.name}(${this.parameters.join(', ')}) {` };
    yield { type: 'indent', content: '  ' };
    if (this.variables.length > 0) {
      yield { type: 'write', content: `let ${this.variables.map(v => v.name).join(', ')};` };
    }
    yield* super.write();
    yield { type: 'dedent' };
    yield { type: 'write', content: `}` };
  }

  get asReference() {
    return new Identifier(this.name);
  }
}

function tryParse(input) {
  try {
    let result = parse(input);
    return { success: true, result };
  } catch (error) {
    return { success: false, error };
  }
}

function generateExpression(target, expression, code, context, secondaryTargets = [], scope = new Map()) {
  if (expression.type === 'sequence') generateSequence(target, expression, code, context, secondaryTargets, scope);
  else if (expression.type === 'choice') generateChoice(target, expression, code, context, secondaryTargets, scope);
  else if (expression.type === 'literal') generateLiteral(target, expression, code, context, secondaryTargets);
  else if (expression.type === 'ruleReference') generateRuleReference(target, expression, code, context, secondaryTargets, scope);
  else if (expression.type === 'class') generateClass(target, expression, code, context, secondaryTargets);
  else if (expression.type === 'any') generateAny(target, expression, code, context, secondaryTargets);
  else if (expression.type === 'lookahead') generateLookahead(target, expression, code, context, secondaryTargets, scope);
  else if (expression.type === 'optional') generateOptional(target, expression, code, context, secondaryTargets, scope);
  else if (expression.type === 'repeated') generateRepeated(target, expression, code, context, secondaryTargets, scope);
  else if (expression.type === 'group') generateExpression(target, expression.expression, code, context, secondaryTargets, scope);
  else if (expression.type === 'text') generateText(target, expression, code, context, secondaryTargets, scope);
  else if (expression.type === 'defaultValue') generateDefaultValue(target, expression, code, context, secondaryTargets, scope);
  else if (expression.type === 'guard') generateGuard(target, expression, code, context, secondaryTargets, scope);
  else throw new Error(`Unknown target type: ${expression.type}`);
}

function generateChoice(target, expression, code, context, secondaryTargets, scope) {
  let { choices } = expression;

  let mark = code.variable('m');
  code.addLine`${mark} = ${context.utils.mark}();`

  for (let [i, choice] of enumerate(choices)) {
    let currentCode = code;
    if (i > 0) {
      let block = new BlockWriter(code);
      currentCode = block;
      code.addLine`if (!${target}.s) ${block}`;
      block.addLine`${mark}.reset();`
    }
    generateExpression(target, choice, currentCode, context, secondaryTargets, scope);
  }
}

function generateSequence(target, expression, code, context, secondaryTargets, scope) {
  let i = 0
  let itemVariables = []
  let currentScope = scope;
  for (let item of expression.items) {
    let currentCode = code
    if (i > 0) {
      let block = new BlockWriter(code);
      currentCode = block;
      code.addLine`if (${target}.s) ${block}`;
    }
    let itemVariable = code.variable('s');
    itemVariables.push(itemVariable);
    generateExpression(target, item.expression, currentCode, context, [itemVariable, ...secondaryTargets], currentScope)
    if (item.localNameInfo) {
      currentScope = new Map(currentScope);
      currentScope.set(item.localNameInfo.id, raw`${itemVariable}.v`);
    }
    i++;
  }
  let returnExpression = new CodeWriter();
  if (expression.returnInfo.type === 'action') {
    returnExpression.add`${generateActionCall(expression.returnExpression, currentScope)}`;
  }
  if (expression.returnInfo.type === 'named') {
    returnExpression.add`{ `
    for (let [index, item] of enumerate(expression.returnInfo.items)) {
      if (index > 0) {
        returnExpression.add`, `
      }
      if (item.isSpread) {
        returnExpression.add`...${itemVariables[item.index]}.v`
      } else {
        let key = item.key;
        returnExpression.add`${json(key)}: ${itemVariables[item.index]}.v`
      }
    }
    returnExpression.add` }`
  }
  if (expression.returnInfo.type === 'array') {
    returnExpression.add`[`
    for (let [index, item] of enumerate(expression.returnInfo.items)) {
      if (index > 0) {
        returnExpression.add`, `
      }
      if (item.isSpread) {
        returnExpression.add`...${itemVariables[item.index]}.v`
      } else {
        returnExpression.add`${itemVariables[item.index]}.v`
      }
    }
    returnExpression.add`]`
  }
  if (expression.returnInfo.type === 'tuple') {
    returnExpression.add`[`
    for (let [index, item] of enumerate(expression.returnInfo.items)) {
      if (index > 0) {
        returnExpression.add`, `
      }
      returnExpression.add`${itemVariables[item.index]}.v`
    }
    returnExpression.add`]`
  }
  if (expression.returnInfo.type === 'single') {
    returnExpression.add`${itemVariables[expression.returnInfo.index]}.v`
  }
  let successBlock = new BlockWriter(code);
  code.addLine`if (${target}.s) ${successBlock}`;
  assignTargets(successBlock, target, secondaryTargets, raw`${context.utils.success}(${returnExpression});`);
}

function assignTargets(code, target, secondaryTargets, assignmentLine) {
  code.add`${target} = `
  for (let secondaryTarget of secondaryTargets) {
    code.add`${secondaryTarget} = `
  }
  code.addLine`${assignmentLine}`;
}

function generateLiteral(target, expression, code, context, secondaryTargets) {
  assignTargets(code, target, secondaryTargets, raw`${context.utils.matchLiteral}(${json(expression.value)});`);
}

function generateRuleReference(target, expression, code, context, secondaryTargets, scope) {
  let ruleFunctionCall = raw`${expression.asReference}(`;

  if (expression.valueArguments) {
    for (let [index, argument] of enumerate(expression.valueArguments)) {
      if (index > 0) {
        ruleFunctionCall.add`, `
      }
      ruleFunctionCall.add`${generateActionCall(argument, scope)}`;
    }
  }

  ruleFunctionCall.add`)`;

  assignTargets(code, target, secondaryTargets, ruleFunctionCall);
}

function generateClass(target, expression, code, context, secondaryTargets) {
  assignTargets(code, target, secondaryTargets, raw`${expression.asReference}();`);
}

function generateAny(target, expression, code, context, secondaryTargets) {
  assignTargets(code, target, secondaryTargets, raw`${context.utils.matchAny}();`);
}

function generateLookahead(target, expression, code, context, secondaryTargets, scope) {
  let mark = code.variable('m');
  code.addLine`${mark} = ${context.utils.mark}();`
  generateExpression(target, expression.expression, code, context, [], scope);
  if (expression.lookaheadType === 'positive') {
    code.add`if (${target}.s)`
  } else if (expression.lookaheadType === 'negative') {
    code.add`if (!${target}.s)`
  }
  let thenBlock = new BlockWriter(code);
  code.addLine` ${thenBlock}`;
  thenBlock.addLine`${mark}.reset();`
  assignTargets(thenBlock, target, secondaryTargets, raw`${context.utils.success}(null);`);
  let elseBlock = new BlockWriter(code);
  code.addLine`else ${elseBlock}`;
  assignTargets(elseBlock, target, secondaryTargets, raw`${context.utils.failure}();`);
}

function generateOptional(target, expression, code, context, secondaryTargets, scope) {
  let mark = code.variable('m');
  code.addLine`${mark} = ${context.utils.mark}();`
  generateExpression(target, expression.expression, code, context, secondaryTargets, scope);
  let block = new BlockWriter(code);
  code.addLine`if (!${target}.s) ${block}`;
  block.addLine`${mark}.reset();`
  assignTargets(block, target, secondaryTargets, raw`${context.utils.success}(null);`);
}

function generateRepeated(target, expression, code, context, secondaryTargets, scope) {
  let { expression: repeatedExpression, separator, quantifier } = expression;

  let min, max;
  if (quantifier.type === 'zeroOrMore') {
    min = null;
    max = null;
  } else if (quantifier.type === 'oneOrMore') {
    min = raw`1`;
    max = null;
  } else if (quantifier.type === 'count') {
    let countVariable = code.variable('count')
    code.addLine`${countVariable} = ${generateActionCall(quantifier.count, scope)};`
    min = countVariable;
    max = countVariable;
  } else if (quantifier.type === 'range') {
    if (quantifier.min) {
      let minVariable = code.variable('min');
      code.addLine`${minVariable} = ${generateActionCall(quantifier.min, scope)};`
      min = minVariable;
    } else {
      min = null;
    }
    if (quantifier.max) {
      let maxVariable = code.variable('max');
      code.addLine`${maxVariable} = ${generateActionCall(quantifier.max, scope)};`
      max = maxVariable;
    } else {
      max = null;
    }
  } else {
    throw new Error(`Unhandled quantifier type: ${quantifier.type}`);
  }

  generateRepeatedExpression(target, repeatedExpression, separator, min, max, code, context, secondaryTargets, scope);
}

function generateRepeatedExpression(target, expression, separator, min, max, code, context, secondaryTargets, scope) {
  let results = code.variable('r');
  let needsIndex = max !== null || min !== null || separator !== null;
  let index = needsIndex ? code.variable('i') : null;
  let mark = code.variable('m');
  code.addLine`${results} = [];`
  if (needsIndex) code.addLine`${index} = 0;`
  code.addLine`${mark} = ${context.utils.mark}();`
  let loop = new BlockWriter(code);
  code.addLine`while (true) ${loop}`;
  if (separator !== null) {
    let thenBlock = new BlockWriter(loop);
    loop.addLine`if (${index} > 0) ${thenBlock}`;
    generateExpression(target, separator, thenBlock, context, [], scope);
    thenBlock.addLine`if (!${target}.s) { break; }`
  }
  generateExpression(target, expression, loop, context, [], scope);
  loop.addLine`if (!${target}.s) { break; }`
  loop.addLine`${results}.push(${target}.v);`
  if (needsIndex) {
    loop.addLine`${index}++;`
  }
  loop.addLine`${mark} = ${context.utils.mark}();`
  if (max !== null) {
    loop.addLine`if (${index} >= ${max}) { break; }`
  }
  code.addLine`${mark}.reset();`
  let successBlock = code
  if (min !== null) {
    let finalBlock = new BlockWriter(code);
    code.addLine`if (${index} < ${min}) ${finalBlock}`;
    assignTargets(finalBlock, target, secondaryTargets, raw`${context.utils.failure}();`);
    successBlock = new BlockWriter(code);
    code.addLine`else ${successBlock}`;
  }
  assignTargets(successBlock, target, secondaryTargets, raw`${context.utils.success}(${results});`);
}

function generateText(target, expression, code, context, secondaryTargets, scope) {
  let mark = code.variable('m');
  code.addLine`${mark} = ${context.utils.mark}();`
  generateExpression(target, expression.expression, code, context, secondaryTargets, scope);
  let successBlock = new BlockWriter(code);
  code.addLine`if (${target}.s) ${successBlock}`;
  assignTargets(successBlock, target, secondaryTargets, raw`${context.utils.success}(${mark}.text());`);
  let failureBlock = new BlockWriter(code);
  code.addLine`else ${failureBlock}`;
  assignTargets(failureBlock, target, secondaryTargets, raw`${context.utils.failure}();`);
}

function generateDefaultValue(target, expression, code, context, secondaryTargets, scope) {
  generateExpression(target, expression.expression, code, context, secondaryTargets, scope);
  let successBlock = new BlockWriter(code);
  code.addLine`if (${target}.s) ${successBlock}`;
  assignTargets(
    successBlock,
    target,
    secondaryTargets,
    raw`${context.utils.success}(${target}.v ?? ${generateActionCall(expression.defaultValue, scope)});`
  );
}

function generateGuard(target, expression, code, context, secondaryTargets, scope) {
  let result = code.variable('r');
  code.addLine`${result} = ${generateActionCall(expression.action, scope)}`;
  let condition = raw`${result}`;
  let successBlock = new BlockWriter(code);
  code.addLine`if (${condition}) ${successBlock}`;
  successBlock.addLine`${target} = ${context.utils.success}(null);`
  let failureBlock = new BlockWriter(code);
  code.addLine`else ${failureBlock}`;
  failureBlock.addLine`${target} = ${context.utils.failure}();`
}

function generateActionCall(action, scope) {
  let result = raw`${action.asReference}(`;

  for (let [parameterIndex, parameter] of enumerate(action.scope)) {
    if (parameterIndex > 0) {
      result.add`, `
    }
    let variable = scope.get(parameter.id);
    if (!variable) {
      throw new Error(`Variable not found in scope: ${parameter.resolvedLocalName}, ${parameter.id}`);
    }
    result.add`${variable}`;
  }

  result.add`)`;

  return result;
}

class JsonWriter {
  constructor(value) {
    this.value = value;
  }

  *write() {
    yield { type: 'write', content: JSON.stringify(this.value) };
  }
}

class BlockWriter extends CodeWriter {
  constructor(parent) {
    super();
    this.parent = parent;
  }

  variable(requestedName) {
    return this.parent.variable(requestedName);
  }

  *write() {
    yield { type: 'writeLine', content: `{` };
    yield { type: 'indent', content: '  ' };
    yield* super.write();
    yield { type: 'dedent' };
    yield { type: 'write', content: `}` };
  }
}

class Identifier {
  constructor(name) {
    this.name = name;
  }

  *write() {
    yield { type: 'write', content: this.name };
  }
}

function json(value) {
  return new JsonWriter(value)
}

function raw(strings, ...values) {
  let writer = new CodeWriter();
  writer.add(strings, ...values);
  return writer;
}

function* walkProgram(program) {
  yield { type: 'program', node: program };
  for (let rule of program.rules) {
    yield* walkRule(rule);
  }
}

function* walkRule(rule) {
  yield { type: 'rule', node: rule };
  yield* walkExpression(rule.body);
}

function* walkExpression(expression) {
  yield { type: 'expression', node: expression };
  if (expression.type === 'sequence') {
    for (let item of expression.items) {
      yield* walkExpression(item.expression);
    }
    if (expression.returnExpression) {
      yield* walkJavascriptExpression(expression.returnExpression)
    }
  }
  else if (expression.type === 'choice') {
    for (let choice of expression.choices) {
      yield* walkExpression(choice);
    }
  }
  else if (expression.type === 'lookahead') {
    yield* walkExpression(expression.expression);
  }
  else if (expression.type === 'guard') {
    yield* walkJavascriptExpression(expression.action);
  }
  else if (expression.type === 'optional') {
    yield* walkExpression(expression.expression);
  }
  else if (expression.type === 'repeated') {
    yield* walkExpression(expression.expression);
    if (expression.separator) yield* walkExpression(expression.separator);
    if (expression.quantifier.type === 'count') {
      yield* walkJavascriptExpression(expression.quantifier.count);
    }
    if (expression.quantifier.type === 'range') {
      if (expression.quantifier.min) yield* walkJavascriptExpression(expression.quantifier.min);
      if (expression.quantifier.max) yield* walkJavascriptExpression(expression.quantifier.max);
    }
  }
  else if (expression.type === 'group') {
    yield* walkExpression(expression.expression);
  }
  else if (expression.type === 'text') {
    yield* walkExpression(expression.expression);
  }
  else if (expression.type === 'defaultValue') {
    yield* walkExpression(expression.expression);
    yield* walkJavascriptExpression(expression.defaultValue);
  }
  else if (expression.type === 'class') { }
  else if (expression.type === 'literal') { }
  else if (expression.type === 'ruleReference') {
    if (expression.valueArguments) {
      for (let argument of expression.valueArguments) {
        yield* walkJavascriptExpression(argument);
      }
    }
  }
  else if (expression.type === 'any') { }
  else {
    throw new Error(`Unknown expression type: ${expression.type}`);
  }
}

function* walkJavascriptExpression(expression) {
  yield { type: 'javascriptExpression', node: expression };
}

function mapSequenceItemForReturnType(item, index) {
  let { localName: explicitLocalName, isSpread, pluckType, pluckName = null } = item;

  let isStandardPluck = pluckType === 'standard';
  let isNamedPluck = pluckType === 'named';
  let isPluck = isStandardPluck || isNamedPluck;

  let localName = item.localNameInfo?.resolvedLocalName ?? null;

  let actualPluckName = pluckName?.name ?? null;

  return {
    index,
    isStandardPluck,
    isNamedPluck,
    isPluck,
    isSpread,
    hasExplicitLocalName: explicitLocalName !== null,
    localName,
    pluckName: actualPluckName,
  }
}
function addSequenceReturnType(sequence) {
  let { items: sequenceItems, returnExpression } = sequence;

  let items = sequenceItems.map((item, index) => mapSequenceItemForReturnType(item, index));

  let hasActionBlock = returnExpression !== null;
  let hasStandardPluck = items.some(item => item.isStandardPluck);
  let hasNamedPluck = items.some(item => item.isNamedPluck);
  let hasPluck = items.some(item => item.isPluck);
  let hasSpread = items.some(item => item.isSpread);

  if (hasActionBlock && hasPluck) {
    throw new Error(`Cannot mix action block and plucks`);
  }

  if (hasActionBlock && hasSpread) {
    throw new Error(`Cannot mix action block and spreads`);
  }

  if (hasStandardPluck && hasNamedPluck) {
    throw new Error(`Cannot mix standard and named plucks`);
  }

  let returnInfo;
  if (hasActionBlock) {
    returnInfo = {
      type: 'action',
    }
  } else {
    let returnType, isImplicitNamedReturn = false;
    if (hasStandardPluck) returnType = 'standard'
    if (hasNamedPluck) returnType = 'named';

    /* TODO implement checking for ALL code blocks */
    let hasCodeBlock = hasActionBlock;

    let hasExplicitLocalNamed = items.some(item => item.hasExplicitLocalName);

    if (!returnType && hasExplicitLocalNamed && !hasCodeBlock) {
      returnType = 'named';
      isImplicitNamedReturn = true;
    }

    if (!returnType) {
      returnType = 'standard';
    }

    let pickedItems

    if (isImplicitNamedReturn) pickedItems = items.filter(item => item.hasExplicitLocalName || item.isSpread);
    else if (hasPluck) pickedItems = items.filter(item => item.isPluck || item.isSpread);
    else pickedItems = items.slice();

    if (returnType === 'named') {
      returnInfo = {
        type: 'named',
        items: pickedItems.map(item => {
          let name = item.isSpread ? null : isImplicitNamedReturn ? item.localName : item.pluckName;
          return {
            index: item.index,
            key: name,
            isSpread: item.isSpread,
          }
        })
      }
    } else if (returnType === 'standard') {
      let standardReturnType;

      if (hasSpread) standardReturnType = 'array';
      else if (pickedItems.length === 0) throw new Error(`Cannot determine return type for sequence with no picked items`);
      else if (pickedItems.length === 1) standardReturnType = 'single';
      else standardReturnType = 'tuple';

      if (standardReturnType === 'array') {
        returnInfo = {
          type: 'array',
          items: pickedItems.map(item => {
            return {
              index: item.index,
              isSpread: item.isSpread,
            }
          })
        }
      }

      if (standardReturnType === 'single') {
        returnInfo = {
          type: 'single',
          index: pickedItems[0].index,
        }
      }

      if (standardReturnType === 'tuple') {
        returnInfo = {
          type: 'tuple',
          items: pickedItems.map(item => {
            return {
              index: item.index,
            }
          })
        }
      }
    }
  }

  if (!returnInfo) {
    throw new Error(`Could not determine return type for sequence`);
  }
  sequence.returnInfo = returnInfo;
}

function compile(input) {
  const result = tryParse(input);
  if (!result.success) {
    return { success: false, error: result.error };
  }

  let program = result.result;

  let rules = program.rules;
  let startRule = rules[0];

  if (!startRule) {
    return { success: false, error: 'No rules defined' };
  }

  let code = new CodeWriter();

  let parseFn = createFunction({ name: 'parse' });
  code.addLine`${parseFn}`;
  let peg$source = parseFn.parameter('peg$source');
  let peg$index = parseFn.variable('peg$index');
  code.addLine`${peg$index} = 0;`
  let success = parseFunction(function peg$success(value) {
    return { s: true, v: value };
  });
  parseFn.addLine`${success}`;
  let failure = parseFunction(function peg$failure() {
    return { s: false };
  });
  parseFn.addLine`${failure}`;

  let matchLiteralFn = parseFunction(function peg$matchLiteral(literal) {
    if (peg$source.substr(peg$index, literal.length) === literal) {
      peg$index += literal.length;
      return peg$success(literal);
    } else {
      return peg$failure();
    }
  })
  parseFn.addLine`${matchLiteralFn}`;

  let matchAnyFn = parseFunction(function peg$matchAny() {
    if (peg$index < peg$source.length) {
      return peg$success(peg$source.charAt(peg$index++));
    } else {
      return peg$failure();
    }
  })
  parseFn.addLine`${matchAnyFn}`;

  let markFn = parseFunction(function peg$mark() {
    let position = peg$index;
    return {
      get position() {
        return position;
      },
      reset() {
        peg$index = position;
      },
      text() {
        return peg$source.slice(position, peg$index);
      }
    }
  })
  parseFn.addLine`${markFn}`;

  let ruleGenerationContext = {
    utils: {
      matchLiteral: matchLiteralFn.asReference,
      matchAny: matchAnyFn.asReference,
      mark: markFn.asReference,
      success: success.asReference,
      failure: failure.asReference,
    }
  }

  let characterClassIndex = 0;
  for (let node of walkProgram(program)) {
    if (node.type === 'expression' && node.node.type === 'class') {
      let characterClass = node.node;
      let classFn = createFunction({ name: `peg$class$${characterClassIndex++}` });
      let c = classFn.variable('c');
      let matched = classFn.variable('matched');
      classFn.addLine`${matched} = false;`
      classFn.addLine`${c} = ${peg$source}.charAt(${peg$index}++);`
      let index = 0
      for (let classElement of characterClass.elements) {
        let lineStart = index === 0 ? 'if' : 'else if';
        let condition
        if (classElement.type === 'character') {
          condition = raw`${c} === ${json(classElement.character)}`;
        } else if (classElement.type === 'range') {
          condition = raw`(${c} >= ${json(classElement.start.character)} && ${c}   <= ${json(classElement.end.character)})`;
        } else {
          throw new Error(`Unknown class element type: ${classElement.type}`);
        }
        classFn.addLine`${lineStart} (${condition}) { ${matched} = true; }`
        index++
      }
      let finalCondition = characterClass.inverted ? `!${matched}` : `${matched}`;
      classFn.addLine`if (${finalCondition}) { return ${success.asReference}(${c}); } else { return ${failure.asReference}(); }`
      characterClass.asReference = classFn.asReference;
      parseFn.addLine`${classFn}`;
    }
  }

  let parsedRules = []
  let ruleMap = new Map();

  /* initialize rule map */
  for (let node of walkProgram(program)) {
    if (node.type === 'rule') {
      let rule = node.node
      let ruleFunctionName = `peg$rule$${rule.name}`;
      let parsedRule = { ruleFunctionName, asReference: new Identifier(ruleFunctionName), rule };
      parsedRules.push(parsedRule);
      ruleMap.set(rule.name, parsedRule);
    }
  }

  /* resolve rule references */
  for (let parsedRule of parsedRules) {
    let body = parsedRule.rule.body;
    for (let node of walkExpression(body)) {
      if (node.type === 'expression' && node.node.type === 'ruleReference') {
        let ruleReference = node.node;
        let referencedRule = ruleMap.get(ruleReference.name);
        if (!referencedRule) {
          throw new Error(`Undefined rule: ${ruleReference.name}`);
        }
        ruleReference.asReference = referencedRule.asReference;
      }
    }
  }

  /* infer localName for sequence items */
  let nextLocalNameId = 1;
  for (let node of walkProgram(program)) {
    if (node.type === 'rule') {
      let rule = node.node;
      for (let parameter of rule.valueParameters) {
        let localName = parameter.name
        parameter.localNameInfo = {
          id: nextLocalNameId++,
          resolvedLocalName: localName,
        };
      }
    }
    if (node.type === 'expression' && node.node.type === 'sequence') {
      for (let item of node.node.items) {
        let resolvedLocalName = item.localName?.name ?? (item.pluckName?.type === 'identifier' ? item.pluckName.name : null);
        if (resolvedLocalName) {
          item.localNameInfo = {
            id: nextLocalNameId++,
            resolvedLocalName,
          };
        }
      }
    }
  }

  /* infer sequence return type */
  for (let node of walkProgram(program)) {
    if (node.type === 'expression' && node.node.type === 'sequence') {
      addSequenceReturnType(node.node);
    }
  }

  /* determine which variables are in scope for expressions and action blocks */
  for (let rule of program.rules) {
    function walkExpressionWithScope(expression, scope) {
      let handled = false;
      if (expression.type === 'choice') {
        for (let choice of expression.choices) {
          walkExpressionWithScope(choice, scope);
        }
        handled = true;
      }
      if (expression.type === 'sequence') {
        let sequenceScope = scope;
        for (let item of expression.items) {
          walkExpressionWithScope(item.expression, sequenceScope);
          let localNameInfo = item.localNameInfo;
          if (localNameInfo) {
            sequenceScope = [...sequenceScope, localNameInfo];
          }
        }
        if (expression.returnExpression) {
          expression.returnExpression.scope = sequenceScope;
        }
        handled = true;
      }
      if (expression.type === 'guard') {
        expression.action.scope = scope;
        handled = true;
      }
      if (expression.type === 'optional' || expression.type === 'repeated' || expression.type === 'group' || expression.type === 'text' || expression.type === 'defaultValue' || expression.type === 'lookahead') {
        walkExpressionWithScope(expression.expression, scope);
        handled = true;
      }
      if (expression.type === 'repeated') {
        if (expression.separator) {
          walkExpressionWithScope(expression.separator, scope);
        }
        if (expression.quantifier.type === 'count') {
          expression.quantifier.count.scope = scope;
        }
        if (expression.quantifier.type === 'range') {
          if (expression.quantifier.min) expression.quantifier.min.scope = scope;
          if (expression.quantifier.max) expression.quantifier.max.scope = scope;
        }
        handled = true;
      }
      if (expression.type === 'defaultValue') {
        expression.defaultValue.scope = scope;
        handled = true;
      }
      if (expression.type === 'ruleReference') {
        if (expression.valueArguments) {
          for (let argument of expression.valueArguments) {
            argument.scope = scope;
          }
        }
        handled = true;
      }
      if (expression.type === 'class' || expression.type === 'literal' || expression.type === 'any') {
        handled = true;
      }
      if (!handled) {
        throw new Error(`Warning: unhandled expression type: ${expression.type}`);
      }
    }
    let scope = [];
    for (let parameter of rule.valueParameters) {
      scope.push(parameter.localNameInfo);
    }
    walkExpressionWithScope(rule.body, scope);
  }

  /* generate actions */
  let nextActionFunctionIndex = 0;
  function createFunctionForAction(scope) {
    let actionFunctionName = `peg$action$${nextActionFunctionIndex++}`;
    let actionFunction = createFunction({ name: actionFunctionName });
    if (!scope) {
      throw new Error(`Action scope not found`);
    }
    for (let localNameInfo of scope) {
      if (!localNameInfo.resolvedLocalName) {
        throw new Error(`Local name not found for id ${localNameInfo.id}`);
      }
      actionFunction.parameter(localNameInfo.resolvedLocalName);
    }
    parseFn.addLine`${actionFunction}`;
    return actionFunction;
  }
  function generateJavascriptExpressionActionFunction(actionBlock) {
    let actionFunction = createFunctionForAction(actionBlock.scope);
    switch (actionBlock.type) {
      case 'identifier': {
        actionFunction.addLine`return ${actionBlock.name};`
        break;
      }
      case 'literal': {
        actionFunction.addLine`return ${json(actionBlock.value)};`
        break;
      }
      case 'expression': {
        actionFunction.addLine`return (${actionBlock.expression});`
        break;
      }
      case 'block': {
        actionFunction.add`${actionBlock.body}`;
        break;
      }
    }
    return actionFunction;
  }
  for (let node of walkProgram(program)) {
    if (node.type === 'javascriptExpression') {
      let actionFunction = generateJavascriptExpressionActionFunction(node.node);
      node.node.asReference = actionFunction.asReference;
    }
  }

  for (let parsedRule of parsedRules) {
    let ruleFn = createFunction({ name: parsedRule.ruleFunctionName });

    let scope = new Map();
    for (let parameter of parsedRule.rule.valueParameters) {
      let addedParameter = ruleFn.parameter('peg$param$' + parameter.localNameInfo.resolvedLocalName);
      scope.set(parameter.localNameInfo.id, addedParameter);
    }

    let t = ruleFn.variable('t');

    generateExpression(t, parsedRule.rule.body, ruleFn, ruleGenerationContext, [], scope);

    ruleFn.addLine`return ${t};`

    parseFn.addLine`${ruleFn}`;
  }

  let parseFullSource = parseFunction(function parseFullSource(startRule) {
    return function () {
      let t = startRule();
      if (t.s && peg$index === peg$source.length) {
        return t;
      } else {
        return peg$failure();
      }
    }
  })

  parseFn.addLine`${parseFullSource}`;

  let parsedStartRule = ruleMap.get(startRule.name);
  if (!parsedStartRule) {
    throw new Error(`Start rule not found: ${startRule.name}`);
  }
  parseFn.addLine`return parseFullSource(${parsedStartRule.asReference})();`

  code.add`\
if (require.main === module) {
  let input = process.argv[2];
  let isFile = input === '-f';
  if (isFile) {
    const fs = require('fs');
    input = fs.readFileSync(process.argv[3], 'utf-8');
  }
  let result = parse(input);
  console.log(JSON.stringify(result, null, 2));
}`

  return { success: true, code: formatWriter(code) };
}

module.exports = { compile };