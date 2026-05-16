Main
  = _ @Program _

Program
  = fileInitializer:(@FileInitializer EndOfStatement _)?
    initializer:(@Initializer EndOfStatement _)? 
    rules:Rule|.., _| {
      let result = {}
      if (fileInitializer) result.fileInitializer = fileInitializer;
      if (initializer) result.initializer = initializer;
      result.rules = rules;
      return result;
    }
  
FileInitializer
  = '{{' body:InsideBalancedBraces '}}' {
      return body;
    }

Initializer
  = '{' body:InsideBalancedBraces '}' {
      return body;
    }

Rule
  = ruleInfo:RuleHeader _ body:Expression EndOfStatement {
    const { name, parameters } = ruleInfo;
    return {
      name,
      templateParameters: parameters?.templateParameters ?? [],
      valueParameters: parameters?.valueParameters ?? [],
      body,
    }
  }

RuleHeader
  = name:Identifier parameters:RuleParameters? _ Equals {
    return {
      name,
      parameters,
    };
  }

Equals
  = !'=>' '='

RuleParameters
  = templateParameters:RuleTemplateParameters? valueParameters:RuleValueParameters {
      return {
        templateParameters: templateParameters ?? [],
        valueParameters: valueParameters,
      };
    }

RuleTemplateParameters
  = '<' _ @RuleTemplateParameter|1.., _ ',' _| _ '>'

RuleTemplateParameter
  = name:Identifier defaultValue:(_ '=' _ @Expression)? {
      return {
        name,
        defaultValue,
      };
  }

RuleValueParameters
  = '(' _ @RuleValueParameter|.., _ ',' _| _ ')'

RuleValueParameter
  = name:Identifier defaultValue:(_ '=' _ @JavascriptExpression)? {
      return {
        name,
        defaultValue,
      };
  }

EndOfStatement
  = (_ ';')+
  / InLineWhitespace EndOfLine
  / _ EndOfFile

Expression
  = ChoiceExpression

ChoiceExpression
  = choices:ActionExpression|1.., __ '/' __| {
    if (choices.length === 1) {
      return choices[0];
    } else {
      return {
        type: 'choice',
        choices,
      };
    }
  }

ActionExpression
  = FOR __ modifier:(@ForModifier __)? '(' _ loopVariable:Identifier ':' iterable:JavascriptExpressionInsideParentheses ')' __ expression:ActionExpression {
    let isAny = modifier?.type === 'any';
    let separator = modifier?.type === 'separated' ? modifier.separator : null;

    return {
      type: 'iterated',
      generationType: isAny ? 'choice' : 'sequence',
      separator,
      iterableExpression: iterable,
      loopVariable: { name: loopVariable },
      expression,
    };
  }
  / expression:PrefixedExpression __ '??' __ defaultValue:JavascriptExpression {
    return {
      type: 'defaultValue',
      expression,
      defaultValue,
    }
  }
  / SequenceExpression

ForModifier
  = FOR_ANY { return { type: 'any' }; }
  / '<' _ separator:Expression _ '>' { return { type: 'separated', separator }; }

ActionBlock
  = '{' body:InsideBalancedBraces '}' {
    return { body };
  }

SequenceExpression
  = items:SequenceElement|1.., __| returnExpression:(__ '=>' __ @JavascriptExpression)? {
    return {
      type: 'sequence',
      items,
      returnExpression,
    }
  }

SequenceElement
  = labels:Labels expression:PrefixedExpression {
      return {
        ...labels,
        expression,
      };
    }

Labels
  = localName:LocalName? pick:Pick? {
    pick ??= { isSpread: false, pluckType: 'none' };
    let result = {
      localName: localName ?? null,
      ...pick,
    }
    return result;
  }

LocalName
  = name:Identifier ':' {
    return { name }
  }

Pick
  = Spread
  / Pluck

Spread
  = spreadTypeSigil:('@:' / '@')? '...' {
    return {
      isSpread: true,
      pluckType: spreadTypeSigil === '@:' ? 'named' : spreadTypeSigil === '@' ? 'standard' : 'none',
    }
  }

Pluck
  = '@' name:(@NamedPluckName ':')? {
    return {
      isSpread: false,
      pluckType: name ? 'named' : 'standard',
      pluckName: name,
    }
  }

NamedPluckName
  = name:Identifier { return { type: 'identifier', name }; }
  / name:String { return { type: 'literal', name }; }

StandardPluck
  = '@'

PrefixedExpression
  = prefixInfo:Prefix? base:SuffixedExpression {
    if (!prefixInfo) {
      return base;
    } else {
      return {
        ...prefixInfo,
        expression: base,
      };
    }
  }

Prefix
  = '&' !'{' { return { type: 'lookahead', lookaheadType: 'positive' }; }
  / '!' !'{' { return { type: 'lookahead', lookaheadType: 'negative' }; }
  / '$' { return { type: 'text' }; }

SuffixedExpression
  = base:PrimaryExpression suffix:Suffix? {
    if (!suffix) {
      return base;
    } else {
      return {
        type: suffix.type,
        expression: base,
        ...suffix.data,
      };
    }
  }

Suffix
  = data:Optional { return { type: 'optional', data }; }
  / repeated:RepeatedExpression? quantifier:Quantifier {
    return {
      type: 'repeated',
      data: {
        separator: repeated?.separator ?? null,
        quantifier: {
          type: quantifier.type,
          ...quantifier.data,
        }
      }
    }
  }

Optional
  = '?'

Quantifier
  = '*' { return { type: 'zeroOrMore' } }
  / '+' { return { type: 'oneOrMore' } }
  / '{' _ min:JavascriptExpression? _ '..' _ max:JavascriptExpression? _ '}' {
    return { type: 'range', data: { min, max } };
  }
  / '{' _ count:JavascriptExpression _ '}' {
    return { type: 'count', data: { count } };
  }

RepeatedExpression
  = '<' _ separator:Expression _ '>' {
    return  { separator }
  }

PrimaryExpression
  = info:RuleReference { return { type: 'ruleReference', ...info }; }
  / info:Literal { return { type: 'literal', ...info }; }
  / info:Class { return { type: 'class', ...info }; }
  / '(' _ expression:Expression _ ')' { return { type: 'group', expression }; }
  / Any { return { type: 'any' }; }
  / info:Guard { return { type: 'guard', ...info }; }
  / info:MatchText { return { type: 'matchText', ...info }; }

RuleReference
  = !RuleHeader name:Identifier args:RuleArguments? {
    return {
      type: 'ruleReference',
      name,
      templateArguments: args?.templateArguments,
      valueArguments: args?.valueArguments,
    }
  }

RuleArguments
  = templateArguments:RuleTemplateArguments? valueArguments:RuleValueArguments {
      return {
        templateArguments,
        valueArguments,
      };
    }

RuleTemplateArguments
  = '<' _ @RuleTemplateArgument|1.., _ ',' _| _ '>'

RuleTemplateArgument
  = Expression

RuleValueArguments
  = '(' _ @RuleArgument|.., _ ',' _| _ ')'

RuleArgument
  = JavascriptExpression

Literal
  = value:String { return { value }; }

Class
  = '[' inverted:'^'? elements:ClassElement* ']' {
    return {
      type: 'class',
      inverted: inverted != null,
      elements,
    };
  }

ClassElement
  = info:ClassRange { return { type: 'range', ...info}}
  / info:ClassCharacter { return { type: 'character', ...info }; }

ClassRange
  = start:ClassCharacter '-' end:ClassCharacter {
    return {
      start,
      end,
    };
  }

ClassCharacter
  = !']' !'\\' !'-' character:. { return { character }; }
  / '\\' @ClassEscapeSequence

ClassEscapeSequence
  = ']' { return { character: ']' }; }
  / '-' { return { character: '-' }; }
  / character:EscapeSequence { return { character }; }

Any
  = '.'
  / ANY

Guard
  = IF _ action:JavascriptExpression {
    return { action };
  }

MatchText
  = '*' expression:JavascriptExpression { return { expression }; }

JavascriptExpression
  = name:Identifier { return { type: 'identifier', name }; }
  / value:Integer { return { type: 'literal', value }; }
  / value:String { return { type: 'literal', value }; }
  / '(' expression:InsideBalancedParentheses ')' { return { type: 'expression', expression }; }
  / block:ActionBlock { return { type: 'block', body: block.body }; }

JavascriptExpressionInsideParentheses
  = _ name:Identifier _ &")" { return { type: 'identifier', name }; }
  / _ value:Integer _ &")" { return { type: 'literal', value }; }
  / _ value:String _ &")" { return { type: 'literal', value }; }
  / _ block:ActionBlock _ &")" { return { type: 'block', body: block.body }; }
  / expression:InsideBalancedParentheses &")" { return { type: 'expression', expression }; }

BalancedParentheses
  = '(' InsideBalancedParentheses ')'

InsideBalancedParentheses
  = $(BalancedParenthesesElement*)

BalancedParenthesesElement
  = ![()] .
  / BalancedParentheses

BalancedBraces
  = $('{' InsideBalancedBraces '}')

InsideBalancedBraces
  = $(BalancedBracesElement*)

BalancedBracesElement
  = ![{}] .
  / BalancedBraces

Integer
  = digits:$[0-9]+ { return parseInt(digits, 10) }

Identifier
  = name:$(IdStart IdContinue*) _Z { return name; }

IdStart
  = [a-zA-Z_]

IdContinue
  = [a-zA-Z0-9_]

_Z
  = !IdContinue

String
  = '"' characters:DoubleStringCharacter* '"' {
    return characters.join('');
  }
  / "'" characters:SingleStringCharacter* "'" {
    return characters.join('');
  }

DoubleStringCharacter
  = !'"' !'\\' character:. { return character; }
  / '\\' @EscapeSequence

SingleStringCharacter
  = !"'" !'\\' character:. { return character; }
  / '\\' @EscapeSequence

EscapeSequence
  = 'b' { return '\b'; }
  / 'f' { return '\f'; }
  / 'n' { return '\n'; }
  / 'r' { return '\r'; }
  / 't' { return '\t'; }
  / 'v' { return '\v'; }
  / character:['"\\] { return character; }
  / 'u' charCode:$(HexDigit HexDigit HexDigit HexDigit) { return String.fromCharCode(parseInt(charCode, 16)); }

HexDigit
  = [0-9a-fA-F]

Whitespace
  = [ \t\r\n]

FOR
  = '?for' _Z

FOR_ANY
  = 'any' _Z

IF
  = '?if' _Z

ANY
  = '?any' _Z

_
  = Whitespace*

__
  = Whitespace+

InLineWhitespace
  = [ \t]*

EndOfLine
  = '\r\n'
  / '\n'
  / '\r'

EndOfFile
  = !.
