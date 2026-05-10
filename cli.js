const fs = require('fs');

let command = process.argv[2];

if (command === 'parse') {
  let input = process.argv[3];
  let output = process.argv[4];
  let source = fs.readFileSync(input, 'utf-8');
  let { parse } = require('./pegm');
  let result = parse(source);
  let outputData = JSON.stringify(result, null, 2);
  fs.writeFileSync(output, outputData, 'utf-8');
} else if (command === 'compile') {
  const { compile } = require('./compile');
  let input = process.argv[3];
  let output = process.argv[4];
  let source = fs.readFileSync(input, 'utf-8');
  let result = compile(source);
  let code = result.code
  fs.writeFileSync(output, code, 'utf-8');
} else {
  console.error('Unknown command:', command);
  console.error('Usage: node cli.js <parse|compile>');
  process.exit(1);
}

