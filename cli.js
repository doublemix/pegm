const fs = require('fs');
const path = require('path');

const VALID_COMMANDS = ['parse', 'compile'];
const VALID_FLAGS = ['--watch', '-w', '--help', '-h'];
const FLAGS_WITH_VALUE = ['--emit-ast'];
const PARSER_MODULE = './pegm';
const COMPILER_MODULE = './compile';
const PARSER_FILE = path.resolve(__dirname, 'pegm.js');
const COMPILER_FILE = path.resolve(__dirname, 'compile.js');

function printUsage() {
  console.log('Usage: node cli.js <command> <input> <output> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  parse     Parse input file and output JSON');
  console.log('  compile   Compile input file to JavaScript');
  console.log('');
  console.log('Options:');
  console.log('  --watch, -w       Watch input file for changes and re-run');
  console.log('  --emit-ast FILE   Output intermediate parse result to FILE (compile only)');
  console.log('  --help, -h        Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  node cli.js parse input.pegm output.json -w');
  console.log('  node cli.js compile -w input.pegm output.js');
  console.log('  node cli.js compile input.pegm output.js --emit-ast ast.json');
}

function validateArguments() {
  const args = process.argv.slice(2);
  const flags = {};
  const positionals = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (FLAGS_WITH_VALUE.includes(arg)) {
      if (i + 1 >= args.length) {
        console.error(`Error: Flag '${arg}' requires a value`);
        printUsage();
        process.exit(1);
      }
      flags[arg] = args[i + 1];
      i++;
      continue;
    }

    if (VALID_FLAGS.includes(arg)) {
      flags[arg] = true;
      continue;
    }

    if (arg.startsWith('-')) {
      console.error(`Error: Unknown flag '${arg}'`);
      const allValidFlags = [...VALID_FLAGS, ...FLAGS_WITH_VALUE];
      console.error(`Valid flags are: ${allValidFlags.join(', ')}`);
      printUsage();
      process.exit(1);
    }

    positionals.push(arg);
  }

  const command = positionals[0];
  const input = positionals[1];
  const output = positionals[2];

  // Check for help flag first
  if (flags['--help'] || flags['-h']) {
    printUsage();
    process.exit(0);
  }

  // Validate command
  if (!command) {
    console.error('Error: Command is required');
    printUsage();
    process.exit(1);
  }

  if (!VALID_COMMANDS.includes(command)) {
    console.error(`Error: Unknown command '${command}'`);
    console.error(`Valid commands are: ${VALID_COMMANDS.join(', ')}`);
    printUsage();
    process.exit(1);
  }

  // Validate input file
  if (!input) {
    console.error('Error: Input file is required');
    printUsage();
    process.exit(1);
  }

  if (!fs.existsSync(input)) {
    console.error(`Error: Input file not found: ${input}`);
    process.exit(1);
  }

  // Check if input is actually a file
  if (!fs.statSync(input).isFile()) {
    console.error(`Error: Input path is not a file: ${input}`);
    process.exit(1);
  }

  // Validate output file
  if (!output) {
    console.error('Error: Output file is required');
    printUsage();
    process.exit(1);
  }

  if (positionals.length > 3) {
    console.error('Error: Too many positional arguments');
    printUsage();
    process.exit(1);
  }

  // Validate output directory exists or can be created
  const outputDir = path.dirname(output);
  if (outputDir !== '.' && !fs.existsSync(outputDir)) {
    console.error(`Error: Output directory does not exist: ${outputDir}`);
    process.exit(1);
  }

  // Validate emit-ast file path if provided
  if (flags['--emit-ast']) {
    const astDir = path.dirname(flags['--emit-ast']);
    if (astDir !== '.' && !fs.existsSync(astDir)) {
      console.error(`Error: AST output directory does not exist: ${astDir}`);
      process.exit(1);
    }
  }

  const isWatch = flags['--watch'] || flags['-w'];
  const emitAst = flags['--emit-ast'];

  return { command, input, output, isWatch, emitAst };
}

function clearRequireCache(modulePath) {
  try {
    delete require.cache[require.resolve(modulePath)];
  } catch (_error) {
    // Ignore if module has not been loaded yet.
  }
}

function runParse(input, output) {
  try {
    let source = fs.readFileSync(input, 'utf-8');
    clearRequireCache(PARSER_MODULE);
    let { parse } = require(PARSER_MODULE);
    let result = parse(source);
    let outputData = JSON.stringify(result, null, 2);
    fs.writeFileSync(output, outputData, 'utf-8');
    console.log(`Successfully parsed ${input} -> ${output}`);
  } catch (error) {
    console.error('Parse failed with errors:');
    console.error(error.message || error);
  }
}

function runCompile(input, output, emitAst) {
  try {
    let source = fs.readFileSync(input, 'utf-8');
    clearRequireCache(PARSER_MODULE);
    clearRequireCache(COMPILER_MODULE);

    // Parse first to get intermediate AST
    let { parse } = require(PARSER_MODULE);
    let parseResult = parse(source);

    // Output intermediate parse result if requested
    if (emitAst) {
      let astData = JSON.stringify(parseResult, null, 2);
      fs.writeFileSync(emitAst, astData, 'utf-8');
      console.log(`  AST written to ${emitAst}`);
    }

    // Now compile
    const { compile } = require(COMPILER_MODULE);
    let result = compile(source);
    if (!result.success) {
      console.error('Compilation failed with errors:');
      console.error(result.error);
      // Clear output file on failure
      fs.writeFileSync(output, '', 'utf-8');
      return;
    }
    let code = result.code;
    fs.writeFileSync(output, code, 'utf-8');
    console.log(`Successfully compiled ${input} -> ${output}`);
  } catch (error) {
    console.error('Compilation failed with errors:');
    console.error(error.message || error);
    // Clear output file on failure
    fs.writeFileSync(output, '', 'utf-8');
  }
}

function startWatch(watchFiles, runFn) {
  const resolvedWatchFiles = [...new Set(watchFiles.map((file) => path.resolve(file)))];

  console.log('Watching files for changes:');
  for (const file of resolvedWatchFiles) {
    console.log(`  - ${file}`);
  }
  runFn();

  let rerunTimer = null;
  const watchers = resolvedWatchFiles
    .filter((file) => {
      if (!fs.existsSync(file)) {
        console.warn(`Warning: Watch file not found, skipping: ${file}`);
        return false;
      }

      return true;
    })
    .map((file) => fs.watch(file, (_eventType, filename) => {
      const changed = filename || path.basename(file);
      console.log(`\nDetected change in ${changed}`);

      if (rerunTimer) {
        clearTimeout(rerunTimer);
      }

      // Debounce rapid save events from editors.
      rerunTimer = setTimeout(() => {
        runFn();
      }, 50);
    }));

  // Allow graceful shutdown on Ctrl+C
  process.on('SIGINT', () => {
    console.log('\nStopping watch mode');
    for (const watcher of watchers) {
      watcher.close();
    }

    if (rerunTimer) {
      clearTimeout(rerunTimer);
    }

    process.exit(0);
  });
}

const { command, input, output, isWatch, emitAst } = validateArguments();

if (command === 'parse') {
  if (isWatch) {
    startWatch([input, PARSER_FILE], () => runParse(input, output));
  } else {
    runParse(input, output);
  }
} else if (command === 'compile') {
  if (isWatch) {
    startWatch([input, PARSER_FILE, COMPILER_FILE], () => runCompile(input, output, emitAst));
  } else {
    runCompile(input, output, emitAst);
  }
}

