import ora from 'ora';

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
