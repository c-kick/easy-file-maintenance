import ora from 'ora';

// Combined error handler function
function globalErrorHandler(error, origin) {
  console.error(`${error} (Origin: ${origin})`);

  // Optionally exit the process on severe errors
  if (origin === 'uncaughtException') {
    process.exit(1); // Non-zero exit code indicates an error
  }
}

// Attach the handler to both unhandledRejection and uncaughtException
process.on('unhandledRejection', (error) => globalErrorHandler(error, 'unhandledRejection'));
process.on('uncaughtException', (error) => globalErrorHandler(error, 'uncaughtException'));

let spinner = null;

const logger = {
  hasInstance: () => {
    return typeof spinner !== 'undefined';
  },
  start: (message) => {
    if (!spinner) {
      spinner = ora(message).start();
    } else {
      spinner.text = message;
      spinner.start();
    }
    return logger; // Enable chaining
  },
  text: (message) => {
    if (!spinner) {
      spinner = ora().start();
    }
    spinner.text = message;
    //console.log(`[LOG] ${message}`); // Log message while updating spinner

    return logger; // Enable chaining
  },
  succeed: (message) => {
    if (spinner) {
      spinner.succeed(message);
      spinner = null;
    } else {
      ora().start().succeed(message);
    }
    return logger; // Enable chaining
  },
  warn: (message) => {
    if (!spinner) {
      spinner = ora().start();
    }
    spinner.warn(`\x1b[33m${message}\x1b[0m`);
    spinner = null;
    return logger; // Enable chaining
  },
  fail: (message) => {
    if (!spinner) {
      spinner = ora().start();
    }
    spinner.fail(`\x1b[31m${message}\x1b[0m`);
    spinner = null;
    return logger; // Enable chaining
  },
  stopAndPersist(options = {}) {
    if (spinner) {
      spinner.stopAndPersist(options);
    } else {
      spinner = ora().start().stopAndPersist(options);
    }
    return logger; // Enable chaining
  },
  stop: () => {
    if (spinner) {
      spinner.stop();
      spinner = null;
    }
    return logger; // Enable chaining
  },
  indent: () => {
    if (spinner) {
      spinner.indent = 2;
    }
    return logger; // Enable chaining
  }
};

console.logExtended = (message) => {
  console.log(JSON.stringify(message, null, 4));
}

export default logger;
