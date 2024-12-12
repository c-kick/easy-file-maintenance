import ora from 'ora';
import { performance } from 'perf_hooks'; // Import the performance API

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
let startTime = null; // Variable to store the high-resolution start time

const logger = {
  hasInstance: () => {
    return typeof spinner !== 'undefined';
  },
  start: (message) => {
    if (!spinner) {
      spinner = ora(message).start();
      startTime = performance.now(); // Start the high-resolution timer
    } else {
      spinner.text = message;
      spinner.start();
      startTime = performance.now(); // Reset the timer
    }
    return logger; // Enable chaining
  },
  text: (message) => {
    if (!spinner) {
      spinner = ora().start();
      startTime = performance.now(); // Start the timer if not already started
    }
    spinner.text = message;
    return logger; // Enable chaining
  },
  succeed: (message) => {
    if (spinner) {
      const duration = (performance.now() - startTime).toFixed(2); // Calculate the elapsed time in milliseconds
      spinner.succeed(`${message} (took ${duration} ms)`);
      spinner = null;
    } else {
      ora().start().succeed(`${message}`);
    }
    return logger; // Enable chaining
  },
  warn: (message) => {
    if (!spinner) {
      spinner = ora().start();
      startTime = performance.now(); // Start the timer if not already started
    }
    spinner.warn(`\x1b[33m${message}\x1b[0m`);
    spinner = null;
    return logger; // Enable chaining
  },
  fail: (message) => {
    if (!spinner) {
      spinner = ora().start();
      startTime = performance.now(); // Start the timer if not already started
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
      startTime = null; // Clear the timer
    }
    return logger; // Enable chaining
  },
  indent: () => {
    if (!spinner) {
      spinner = ora().start();
      startTime = performance.now(); // Start the timer if not already started
    }
    spinner.indent = 2;
    return logger; // Enable chaining
  }
};

console.logExtended = (message) => {
  console.log(JSON.stringify(message, null, 4));
}

export default logger;
