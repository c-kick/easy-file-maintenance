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
    if (spinner) {
      spinner.text = message;
    }
    return logger; // Enable chaining
  },
  succeed: (message) => {
    if (spinner) {
      spinner.succeed(message);
      spinner = null;
    }
    return logger; // Enable chaining
  },
  fail: (message) => {
    if (spinner) {
      spinner.fail(message);
      spinner = null;
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
};

export default logger;
