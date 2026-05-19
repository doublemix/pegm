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

function createFunction({ name, parent } = {}) {
  let createdFunction = new FunctionWriter();
  if (name) createdFunction.name = name;
  if (parent) createdFunction.parent = parent;
  return createdFunction;
}

/* TODO delete this, the variable references aren't resolved against there real names */
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

  setIndent(indent) {
    this.instructions.push({ type: 'setIndent', content: indent });
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
    this.namesDeclared = new Set();
    this.namesInUse = new Set();
    this.parent = null;
  }

  isNameDeclared(name) {
    if (this.namesDeclared.has(name)) {
      return true;
    }
    if (this.parent) {
      return this.parent.isNameDeclared(name);
    }
    return false;
  }

  isNameConflicting(name) {
    if (this.namesInUse.has(name)) {
      return true;
    }
    if (this.parent) {
      return this.parent.isNameDeclared(name);
    }
    return false;
  }

  getNonConflictingName(requestedName, { alwaysIncludeIndex = false } = {}) {
    let name = requestedName;
    let suffix = 0;
    if (alwaysIncludeIndex) {
      name = `${requestedName}${suffix++}`;
    }
    while (this.isNameConflicting(name)) {
      name = `${requestedName}${suffix++}`;
    }
    return name;
  }

  freeVariable(name) {
    this.namesInUse.delete(name);
  }

  parameter(requestedName, initializer) {
    let name = this.getNonConflictingName(requestedName);
    this.namesInUse.add(name);
    this.namesDeclared.add(name);
    this.parameters.push({ name, initializer });
    return new Identifier(name);
  }

  variable(requestedName, { alwaysIncludeIndex = false } = {}) {
    let name = this.getNonConflictingName(requestedName, { alwaysIncludeIndex });
    if (!this.variables.some(v => v.name === name)) {
      this.namesDeclared.add(name);
      this.variables.push({ name });
    }
    this.namesInUse.add(name);
    return new Variable(name, this);
  }

  *write() {
    yield { type: 'write', content: `function ` };
    if (this.name) {
      yield { type: 'write', content: this.name };
    }
    yield { type: 'write', content: '(' };
    for (let [index, parameter] of enumerate(this.parameters)) {
      if (index > 0) {
        yield { type: 'write', content: ', ' };
      }
      yield { type: 'write', content: parameter.name };
      if (parameter.initializer) {
        yield { type: 'write', content: ' = ' };
        yield* parameter.initializer.write();
      }
    }
    yield { type: 'write', content: ')' };
    yield { type: 'writeLine', content: ' {' };
    yield { type: 'indent', content: '  ' };
    if (this.variables.length > 0) {
      yield { type: 'writeLine', content: `let ${this.variables.map(v => v.name).join(', ')};` };
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

function generateInlineRule(expression, context, parent) {
  let ruleFunction = createFunction({ parent });

  generateRuleFunctionBody(ruleFunction, expression, context)

  return ruleFunction;
}

function generateRuleFunctionBody(ruleFn, expression, context) {
  let t = ruleFn.variable('t');

  generateExpression(t, expression, ruleFn, context, null);

  ruleFn.addLine`return ${t};`
}

function generateExpression(target, expression, code, context, secondaryTarget = null) {
  if (expression.type === 'sequence') generateSequence(target, expression, code, context, secondaryTarget);
  else if (expression.type === 'choice') generateChoice(target, expression, code, context, secondaryTarget);
  else if (expression.type === 'literal') generateLiteral(target, expression, code, context, secondaryTarget);
  else if (expression.type === 'ruleReference') generateRuleReference(target, expression, code, context, secondaryTarget);
  else if (expression.type === 'class') generateClass(target, expression, code, context, secondaryTarget);
  else if (expression.type === 'any') generateAny(target, expression, code, context, secondaryTarget);
  else if (expression.type === 'lookahead') generateLookahead(target, expression, code, context, secondaryTarget);
  else if (expression.type === 'optional') generateOptional(target, expression, code, context, secondaryTarget);
  else if (expression.type === 'repeated') generateRepeated(target, expression, code, context, secondaryTarget);
  else if (expression.type === 'group') generateExpression(target, expression.expression, code, context, secondaryTarget);
  else if (expression.type === 'text') generateText(target, expression, code, context, secondaryTarget);
  else if (expression.type === 'defaultValue') generateDefaultValue(target, expression, code, context, secondaryTarget);
  else if (expression.type === 'guard') generateGuard(target, expression, code, context, secondaryTarget);
  else if (expression.type === 'matchText') generateMatchText(target, expression, code, context, secondaryTarget);
  else if (expression.type === 'iterated') generateIterated(target, expression, code, context, secondaryTarget);
  else if (expression.type === 'value') generateValue(target, expression, code, context, secondaryTarget);
  else throw new Error(`Unknown target type: ${expression.type}`);
}

function generateChoice(target, expression, code, context, secondaryTarget) {
  let { choices } = expression;

  let mark = code.variable('m', { alwaysIncludeIndex: true });
  code.addLine`${mark} = ${context.utils.mark}();`

  for (let [i, choice] of enumerate(choices)) {
    let currentCode = code;
    if (i > 0) {
      let block = new BlockWriter(code);
      currentCode = block;
      code.addLine`if (!${target}.s) ${block}`;
      block.addLine`${mark}.reset();`
    }
    generateExpression(target, choice, currentCode, context, null);
  }
  if (secondaryTarget) {
    assignTargets(code, secondaryTarget, null, raw`${target}`);
  }

  mark.free();
}

function generateSequence(target, expression, code, context, secondaryTarget) {
  let i = 0
  let itemVariables = []
  let currentScope = context.scope;
  for (let item of expression.items) {
    let currentCode = code
    if (i > 0) {
      let block = new BlockWriter(code);
      currentCode = block;
      code.addLine`if (${target}.s) ${block}`;
    }
    let itemVariable = code.variable('s', { alwaysIncludeIndex: true });
    itemVariables.push(itemVariable);
    generateExpression(target, item.expression, currentCode, { ...context, scope: currentScope }, itemVariable)
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
  assignTargets(successBlock, target, null, raw`${context.utils.success}(${returnExpression});`);
  if (secondaryTarget) {
    assignTargets(successBlock, secondaryTarget, null, raw`${target}`);
  }

  for (let itemVariable of itemVariables) {
    itemVariable.free();
  }
}

function assignTargets(code, target, secondaryTarget = null, assignmentLine) {
  code.add`${target} = `
  if (secondaryTarget !== null) {
    code.add`${secondaryTarget} = `
  }
  code.addLine`${assignmentLine}`;
}

function generateLiteral(target, expression, code, context, secondaryTarget) {
  assignTargets(code, target, secondaryTarget, raw`${context.utils.matchText}(${json(expression.value)});`);
}

function generateRuleReference(target, expression, code, context, secondaryTarget) {
  let asReference;

  if (expression.referenceInfo.type === 'rule') {
    asReference = expression.referenceInfo.rule.asReference;
  } else if (expression.referenceInfo.type === 'templateParameter') {
    let { parameter: templateParameter } = expression.referenceInfo;
    let { name } = templateParameter;
    let templateParameterValue = context.templateScope.get(name);
    asReference = templateParameterValue;
  }

  let ruleFunctionCall = raw`${asReference}(`;

  let referenceInfo = expression.referenceInfo;

  let overallParameterIndex = 0;

  if (referenceInfo.type === 'rule') {
    let { templateParameters } = referenceInfo.rule.rule;

    for (let [parameterIndex, templateParameter] of enumerate(templateParameters)) {
      if (overallParameterIndex > 0) {
        ruleFunctionCall.add`, `
      }

      let argumentExpression = expression.templateArguments?.[parameterIndex] ?? null;
      if (argumentExpression !== null) {
        let argumentRuleFunction = generateInlineRule(argumentExpression, context, code);
        ruleFunctionCall.add`${argumentRuleFunction}`;
      } else {
        ruleFunctionCall.add`undefined`;
      }

      overallParameterIndex++;
    }
  }

  if (expression.valueArguments) {
    for (let argument of expression.valueArguments) {
      if (overallParameterIndex > 0) {
        ruleFunctionCall.add`, `
      }
      ruleFunctionCall.add`${generateActionCall(argument, context.scope)}`;

      overallParameterIndex++;
    }
  }

  ruleFunctionCall.add`)`;

  assignTargets(code, target, secondaryTarget, ruleFunctionCall);
}

function generateClass(target, expression, code, context, secondaryTarget) {
  assignTargets(code, target, secondaryTarget, raw`${expression.asReference}();`);
}

function generateAny(target, expression, code, context, secondaryTarget) {
  assignTargets(code, target, secondaryTarget, raw`${context.utils.matchAny}();`);
}

function generateLookahead(target, expression, code, context, secondaryTarget) {
  let mark = code.variable('m', { alwaysIncludeIndex: true });
  code.addLine`${mark} = ${context.utils.mark}();`
  generateExpression(target, expression.expression, code, context, null);
  if (expression.lookaheadType === 'positive') {
    code.add`if (${target}.s)`
  } else if (expression.lookaheadType === 'negative') {
    code.add`if (!${target}.s)`
  }
  let thenBlock = new BlockWriter(code);
  code.addLine` ${thenBlock}`;
  thenBlock.addLine`${mark}.reset();`
  assignTargets(thenBlock, target, secondaryTarget, raw`${context.utils.success}(null);`);
  let elseBlock = new BlockWriter(code);
  code.addLine`else ${elseBlock}`;
  assignTargets(elseBlock, target, secondaryTarget, raw`${context.utils.failure}();`);
  mark.free();
}

function generateOptional(target, expression, code, context, secondaryTarget) {
  let mark = code.variable('m', { alwaysIncludeIndex: true });
  code.addLine`${mark} = ${context.utils.mark}();`
  generateExpression(target, expression.expression, code, context, null);
  let block = new BlockWriter(code);
  code.addLine`if (!${target}.s) ${block}`;
  block.addLine`${mark}.reset();`
  assignTargets(block, target, null, raw`${context.utils.success}(null);`);
  if (secondaryTarget) {
    assignTargets(code, secondaryTarget, null, raw`${target}`);
  }
  mark.free();
}

function generateRepeated(target, expression, code, context, secondaryTarget) {
  let { expression: repeatedExpression, separator, quantifier } = expression;

  let min, max, minVariable, maxVariable, countVariable;
  if (quantifier.type === 'zeroOrMore') {
    min = null;
    max = null;
  } else if (quantifier.type === 'oneOrMore') {
    min = raw`1`;
    max = null;
  } else if (quantifier.type === 'count') {
    countVariable = code.variable('count', { alwaysIncludeIndex: true });
    code.addLine`${countVariable} = ${generateActionCall(quantifier.count, context.scope)};`
    min = countVariable;
    max = countVariable;
  } else if (quantifier.type === 'range') {
    if (quantifier.min) {
      minVariable = code.variable('min', { alwaysIncludeIndex: true });
      code.addLine`${minVariable} = ${generateActionCall(quantifier.min, context.scope)};`
      min = minVariable;
    } else {
      min = null;
    }
    if (quantifier.max) {
      maxVariable = code.variable('max', { alwaysIncludeIndex: true });
      code.addLine`${maxVariable} = ${generateActionCall(quantifier.max, context.scope)};`
      max = maxVariable;
    } else {
      max = null;
    }
  } else {
    throw new Error(`Unhandled quantifier type: ${quantifier.type}`);
  }

  generateRepeatedExpression(target, repeatedExpression, separator, min, max, code, context, secondaryTarget);

  if (countVariable) countVariable.free();
  if (minVariable) minVariable.free();
  if (maxVariable) maxVariable.free();
}

function generateRepeatedExpression(target, expression, separator, min, max, code, context, secondaryTarget) {
  let results = code.variable('r', { alwaysIncludeIndex: true });
  let needsIndex = max !== null || min !== null || separator !== null;
  let index = needsIndex ? code.variable('i', { alwaysIncludeIndex: true }) : null;
  let mark = code.variable('m', { alwaysIncludeIndex: true });
  code.addLine`${results} = [];`
  if (needsIndex) code.addLine`${index} = 0;`
  code.addLine`${mark} = ${context.utils.mark}();`
  let loop = new BlockWriter(code);
  code.addLine`while (true) ${loop}`;
  if (separator !== null) {
    let thenBlock = new BlockWriter(loop);
    loop.addLine`if (${index} > 0) ${thenBlock}`;
    generateExpression(target, separator, thenBlock, context, null);
    thenBlock.addLine`if (!${target}.s) { break; }`
  }
  generateExpression(target, expression, loop, context, null);
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
    assignTargets(finalBlock, target, secondaryTarget, raw`${context.utils.failure}();`);
    successBlock = new BlockWriter(code);
    code.addLine`else ${successBlock}`;
  }
  assignTargets(successBlock, target, secondaryTarget, raw`${context.utils.success}(${results});`);
  results.free();
  if (needsIndex) index.free();
  mark.free();
}

function generateText(target, expression, code, context, secondaryTarget) {
  let mark = code.variable('m', { alwaysIncludeIndex: true });
  code.addLine`${mark} = ${context.utils.mark}();`
  generateExpression(target, expression.expression, code, context, secondaryTarget);
  let successBlock = new BlockWriter(code);
  code.addLine`if (${target}.s) ${successBlock}`;
  assignTargets(successBlock, target, secondaryTarget, raw`${context.utils.success}(${mark}.text());`);
  let failureBlock = new BlockWriter(code);
  code.addLine`else ${failureBlock}`;
  assignTargets(failureBlock, target, secondaryTarget, raw`${context.utils.failure}();`);
  mark.free();
}

function generateDefaultValue(target, expression, code, context, secondaryTarget) {
  generateExpression(target, expression.expression, code, context, null);
  let successBlock = new BlockWriter(code);
  code.addLine`if (${target}.s) ${successBlock}`;
  assignTargets(
    successBlock,
    target,
    null,
    raw`${context.utils.success}(${target}.v ?? ${generateActionCall(expression.defaultValue, context.scope)});`
  );
  if (secondaryTarget) {
    assignTargets(code, secondaryTarget, null, raw`${target}`);
  }
}

function generateGuard(target, expression, code, context, secondaryTarget) {
  let result = code.variable('r', { alwaysIncludeIndex: true });
  code.addLine`${result} = ${generateActionCall(expression.action, context.scope)}`;
  let condition = raw`${result}`;
  let successBlock = new BlockWriter(code);
  code.addLine`if (${condition}) ${successBlock}`;
  assignTargets(successBlock, target, secondaryTarget, raw`${context.utils.success}(null)`);
  let failureBlock = new BlockWriter(code);
  code.addLine`else ${failureBlock}`;
  assignTargets(failureBlock, target, secondaryTarget, raw`${context.utils.failure}();`);
  result.free();
}

function generateMatchText(target, expression, code, context, secondaryTarget) {
  let textToMatch = code.variable('tt', { alwaysIncludeIndex: true });
  code.addLine`${textToMatch} = ${generateActionCall(expression.expression, context.scope)};`
  assignTargets(code, target, secondaryTarget, raw`${context.utils.matchText}(${textToMatch})`);
  textToMatch.free();
}

function generateIterated(target, expression, code, context, secondaryTarget) {
  if (expression.generationType === 'sequence') {
    let r
    generateIteratedCore(
      target,
      expression,
      code,
      context,
      secondaryTarget,
      () => {
        r = code.variable('r', { alwaysIncludeIndex: true });
        code.addLine`${r} = [];`
        code.addLine`${target} = ${context.utils.success}(null);`
      },
      () => {
        return raw`!${target}.s`
      },
      () => {
        return raw`${r}.push(${target}.v);`
      },
      () => {
        return raw`${r}`;
      },
      () => {
        r.free();
      }
    )
  }
  else if (expression.generationType === 'choice') {
    let m
    generateIteratedCore(
      target,
      expression,
      code,
      context,
      secondaryTarget,
      () => {
        m = code.variable('m', { alwaysIncludeIndex: true });
        code.addLine`${m} = ${context.utils.mark}();`
        code.addLine`${target} = ${context.utils.failure}(null);`
      },
      () => {
        return raw`${target}.s`
      },
      () => {
        return raw`${m}.reset();`
      },
      null,
      () => {
        m.free();
      }
    );

  }
}

function generateIteratedCore(target, expression, code, context, secondaryTarget, initialize, breakCondition, onIterationMatch, getResult, cleanup) {
  let { separator } = expression;
  let needsIndex = separator !== null;
  initialize();
  let index = needsIndex ? code.variable('i', { alwaysIncludeIndex: true }) : null;
  let iterable = code.variable('iter', { alwaysIncludeIndex: true });
  code.addLine`${iterable} = ${generateActionCall(expression.iterableExpression, context.scope)};`
  if (needsIndex) code.addLine`${index} = 0;`
  let loopVariable = code.variable('it', { alwaysIncludeIndex: true });
  let loop = new BlockWriter(code);
  code.addLine`for (let ${loopVariable} of ${iterable}) ${loop}`;
  if (separator !== null) {
    let thenBlock = new BlockWriter(loop);
    loop.addLine`if (${index} > 0) ${thenBlock}`;
    generateExpression(target, separator, thenBlock, context, null);
    thenBlock.addLine`if (!${target}.s) { break; }`
  }
  let newScope = new Map(context.scope);
  newScope.set(expression.loopVariable.localNameInfo.id, loopVariable);
  let iterationContext = { ...context, scope: newScope };
  generateExpression(target, expression.expression, loop, iterationContext, null);
  let iterationMatchCondition = breakCondition();
  loop.addLine`if (${iterationMatchCondition}) { break; }`;
  loop.addLine`${onIterationMatch()}`;
  if (needsIndex) loop.addLine`${index}++;`
  if (getResult !== null) {
    let successBlock = new BlockWriter(code);
    code.addLine`if (t.s) ${successBlock}`;
    assignTargets(successBlock, target, secondaryTarget, raw`${context.utils.success}(${getResult()})`);
  } else if (secondaryTarget) {
    assignTargets(code, secondaryTarget, null, raw`${target}`);
  }
  iterable.free();
  loopVariable.free();
  if (needsIndex) index.free();
  cleanup();
}

function generateValue(target, expression, code, context, secondaryTarget) {
  assignTargets(code, target, secondaryTarget, raw`${context.utils.success}(${generateActionCall(expression.expression, context.scope)})`);
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

  isNameDeclared(name) {
    if (this.parent) this.parent.isNameDeclared(name);
    return false;
  }

  variable(requestedName, options) {
    return this.parent.variable(requestedName, options);
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

class Variable extends Identifier {
  constructor(name, parentFunction) {
    super(name);
    this.parentFunction = parentFunction;
  }

  free() {
    this.parentFunction.freeVariable(this.name);
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
  for (let parameter of rule.templateParameters) {
    if (parameter.defaultValue) {
      yield* walkExpression(parameter.defaultValue);
    }
  }
  for (let parameter of rule.valueParameters) {
    if (parameter.defaultValue) {
      yield* walkJavascriptExpression(parameter.defaultValue);
    }
  }
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
    if (expression.templateArguments) {
      for (let argument of expression.templateArguments) {
        yield* walkExpression(argument);
      }
    }
    if (expression.valueArguments) {
      for (let argument of expression.valueArguments) {
        yield* walkJavascriptExpression(argument);
      }
    }
  }
  else if (expression.type === 'any') { }
  else if (expression.type === 'matchText') {
    yield* walkJavascriptExpression(expression.expression);
  }
  else if (expression.type === 'iterated') {
    yield* walkJavascriptExpression(expression.iterableExpression);
    if (expression.separator !== null) {
      yield* walkExpression(expression.separator);
    }
    yield* walkExpression(expression.expression);
  }
  else if (expression.type === 'value') {
    yield* walkJavascriptExpression(expression.expression);
  }
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

    if (!returnType) {
      returnType = 'standard';
    }

    let pickedItems

    if (hasPluck) pickedItems = items.filter(item => item.isPluck || item.isSpread);
    else pickedItems = items.slice();

    if (returnType === 'named') {
      returnInfo = {
        type: 'named',
        items: pickedItems.map(item => {
          let name = item.isSpread ? null : item.pluckName;
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

  if (program.fileInitializer) {
    code.setIndent('');
    code.addLine`${program.fileInitializer}`;
    code.dedent();
  }

  let parseFn = createFunction({ name: 'parse' });
  code.addLine`${parseFn}`;
  let peg$source = parseFn.parameter('peg$source');
  let peg$index = parseFn.variable('peg$index');
  let peg$line = parseFn.variable('peg$line');
  let peg$column = parseFn.variable('peg$column');
  parseFn.addLine`${peg$index} = 0;`
  parseFn.addLine`${peg$line} = 1;`
  parseFn.addLine`${peg$column} = 1;`
  let peg$advance = parseFunction(function peg$advance(n = 1) {
    let result = peg$source.substr(peg$index, n);
    let countNewLines = 0;
    let lastNewLineIndex = -1;
    for (let i = 0; i < result.length; i++) {
      if (result.charAt(i) === '\n') {
        countNewLines++;
        lastNewLineIndex = i;
      }
    }
    if (countNewLines > 0) {
      peg$line += countNewLines;
      peg$column = result.length - lastNewLineIndex;
    } else {
      peg$column += n;
    }
    peg$index += n;
    return result;
  });
  parseFn.addLine`${peg$advance}`;
  let success = parseFunction(function peg$success(value) {
    return { s: true, v: value };
  });
  parseFn.addLine`${success}`;
  let peg$maxFailurePosition = parseFn.variable('peg$maxFailurePosition');
  parseFn.addLine`${peg$maxFailurePosition} = null;`
  let failure = parseFunction(function peg$failure(expected = null) {
    if (peg$maxFailurePosition === null || peg$index > peg$maxFailurePosition.position) {
      peg$maxFailurePosition = {
        position: peg$index,
        line: peg$line,
        column: peg$column,
        expected: expected !== null ? [expected] : [],
      }
    } else if (peg$index === peg$maxFailurePosition.position) {
      if (expected !== null) {
        peg$maxFailurePosition.expected.push(expected);
      }
    }
    return { s: false };
  });
  parseFn.addLine`${failure}`;

  let matchTextFn = parseFunction(function peg$matchText(text) {
    if (peg$source.substr(peg$index, text.length) === text) {
      return peg$success(peg$advance(text.length));
    } else {
      return peg$failure({ text });
    }
  })
  parseFn.addLine`${matchTextFn}`;

  let matchAnyFn = parseFunction(function peg$matchAny() {
    if (peg$index < peg$source.length) {
      return peg$success(peg$advance());
    } else {
      return peg$failure({ any: true });
    }
  })
  parseFn.addLine`${matchAnyFn}`;

  let markFn = parseFunction(function peg$mark() {
    let position = peg$index;
    let line = peg$line;
    let column = peg$column;
    return {
      get position() {
        return position;
      },
      reset() {
        peg$index = position;
        peg$line = line;
        peg$column = column;
      },
      text() {
        return peg$source.slice(position, peg$index);
      }
    }
  })
  parseFn.addLine`${markFn}`;

  let ruleGenerationContext = {
    utils: {
      matchText: matchTextFn.asReference,
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
      classFn.addLine`${c} = ${peg$source}.charAt(${peg$index});`
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
      let finalCondition = characterClass.inverted ? raw`!${matched}` : raw`${matched}`;
      classFn.addLine`if (${finalCondition}) { return ${success.asReference}(${peg$advance}()); } else { return ${failure.asReference}(${JSON.stringify({ class: characterClass })}); }`
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
    let rule = parsedRule.rule

    let templateParameterMap = new Map();

    for (let parameter of rule.templateParameters) {
      templateParameterMap.set(parameter.name, parameter);
    }

    for (let node of walkRule(rule)) {
      if (node.type === 'expression' && node.node.type === 'ruleReference') {
        let ruleReference = node.node;
        let referenceInfo;

        let templateRuleReference = templateParameterMap.get(ruleReference.name);
        if (templateRuleReference) {
          referenceInfo = {
            type: 'templateParameter',
            parameter: templateRuleReference,
          }
        }

        if (!referenceInfo) {
          let referencedRule = ruleMap.get(ruleReference.name);

          if (referencedRule) {

            referenceInfo = {
              type: 'rule',
              rule: referencedRule,
            };
          }
        }

        if (!referenceInfo) {
          throw new Error(`Undefined rule: ${ruleReference.name}`);
        }

        ruleReference.referenceInfo = referenceInfo;
      }
    }
  }

  /* ensure template parameter references have values */
  for (let node of walkProgram(program)) {
    if (node.type === 'expression' && node.node.type === 'ruleReference') {
      let ruleReference = node.node;
      if (ruleReference.referenceInfo.type === 'templateParameter') {
        // template parameter references don't support template arguments
        if (ruleReference.templateArguments) {
          throw new Error(`Template parameter reference cannot have template arguments: ${ruleReference.name}`);
        }
        if (ruleReference.valueArguments) {
          throw new Error(`Template parameter reference cannot have value arguments: ${ruleReference.name}`);
        }
      }
      if (ruleReference.referenceInfo.type === 'rule') {
        let rule = node.node.referenceInfo.rule.rule;
        let templateArguments = ruleReference.templateArguments ?? [];
        for (let [index, parameter] of enumerate(rule.templateParameters)) {
          let argument = templateArguments[index] ?? null;
          if (argument === null && parameter.defaultValue === null) {
            throw new Error(`Missing template argument for parameter ${parameter.name} in reference to rule ${rule.name}`);
          }
        }
      }
    }
  }

  /* infer localName for sequence items, attach local name info to all nodes that create local names for action execution contexts */
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
    if (node.type === 'expression' && node.node.type === 'iterated') {
      let item = node.node;
      let loopVariableName = item.loopVariable.name
      item.loopVariable.localNameInfo = {
        id: nextLocalNameId++,
        resolvedLocalName: loopVariableName,
      };
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
      /* TODO maybe don't handle all these in one place, for better readability */
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
        if (expression.templateArguments) {
          for (let argument of expression.templateArguments) {
            walkExpressionWithScope(argument, scope);
          }
        }
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
      if (expression.type === 'matchText') {
        expression.expression.scope = scope;
        handled = true;
      }
      if (expression.type === 'iterated') {
        expression.iterableExpression.scope = scope;
        if (expression.separator !== null) {
          walkExpressionWithScope(expression.separator, scope);
        }
        let loopScope = [...scope, expression.loopVariable.localNameInfo];
        walkExpressionWithScope(expression.expression, loopScope);
        handled = true;
      }
      if (expression.type === 'value') {
        expression.expression.scope = scope;
        handled = true;
      }
      if (!handled) {
        throw new Error(`Warning: unhandled expression type: ${expression.type}`);
      }
    }
    let scope = [];
    for (let parameter of rule.valueParameters) {
      if (parameter.defaultValue) {
        parameter.defaultValue.scope = scope;
      }
      scope = [...scope, parameter.localNameInfo];
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


  function generateRule(parsedRule) {
    const { rule, ruleFunctionName } = parsedRule;

    let ruleFn = createFunction({ name: parsedRule.ruleFunctionName });

    /* TODO: it might be nice for template scope to use a resolved ID like value parameters, but not necessary currently, because they can't introduce inside rules */
    let templateScope = new Map();

    for (let parameter of parsedRule.rule.templateParameters) {
      let initializer = null;
      let addedTemplateParameter = ruleFn.parameter('peg$tparam$' + parameter.name);
      parameter.functionParameter = addedTemplateParameter;
      templateScope.set(parameter.name, addedTemplateParameter);
    }

    let scope = new Map();
    for (let parameter of parsedRule.rule.valueParameters) {
      let initializer = null;
      if (parameter.defaultValue) {
        initializer = generateActionCall(parameter.defaultValue, scope)
      }
      let addedParameter = ruleFn.parameter('peg$param$' + parameter.localNameInfo.resolvedLocalName, initializer);
      scope.set(parameter.localNameInfo.id, addedParameter);
    }

    let context = {
      utils: ruleGenerationContext.utils,
      scope,
      templateScope
    }

    for (let parameter of parsedRule.rule.templateParameters) {
      if (parameter.defaultValue) {
        let initializer = generateInlineRule(parameter.defaultValue, context, ruleFn);
        ruleFn.addLine`if (${parameter.functionParameter} === undefined) { ${parameter.functionParameter} = ${initializer}; }`
      }
    }

    generateRuleFunctionBody(ruleFn, rule.body, context);

    return ruleFn;
  }

  for (let parsedRule of parsedRules) {
    let ruleFn = generateRule(parsedRule);
    parseFn.addLine`${ruleFn}`;
  }

  let parseFullSource = parseFunction(function parseFullSource(startRule) {
    return function () {
      let t = startRule();
      if (t.s && peg$index === peg$source.length) {
        return {
          success: true,
          value: t.v,
        }
      } else {
        return {
          success: false,
          index: peg$maxFailurePosition.position,
          line: peg$maxFailurePosition.line,
          column: peg$maxFailurePosition.column,
          expected: peg$maxFailurePosition.expected,
        }
      }
    }
  })

  parseFn.addLine`${parseFullSource}`;

  let parsedStartRule = ruleMap.get(startRule.name);
  if (!parsedStartRule) {
    throw new Error(`Start rule not found: ${startRule.name}`);
  }
  if (program.initializer) {
    parseFn.setIndent('')
    parseFn.addLine`${program.initializer}`;
    parseFn.dedent();
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
} else {
  module.exports = { parse: ${parseFn.asReference} };
}`

  return { success: true, code: formatWriter(code) };
}

module.exports = { compile };