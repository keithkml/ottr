#!/usr/bin/env node
/*
 * MIT License
 *
 * Copyright (c) 2017 Uber Node.js
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/* eslint-disable no-process-exit,node/shebang,no-unreachable */
// @flow

import 'source-map-support/register';

import 'babel-polyfill';

import fs from 'fs';
import {packageForBrowser} from './packager';
import path from 'path';
import {logEachLine} from '../util';
import commander from 'commander';
import {ChromeRunner, runChrome} from './chrome';
import {spawn} from 'child_process';
import {createSession, DEFAULT_ERROR, getSessions} from './server/sessions';
import {startOttrServer} from './server';

const run = (title, cmd, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, [], options);
    child.stdout.on('data', data => logEachLine(`[${title}]`, data));
    child.stderr.on('data', data => logEachLine(`!${title}!`, data));
    child.on('exit', code => (code === 0 ? resolve() : reject(code)));
  });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class Ottr {
  command;
  chrome: ChromeRunner;

  constructor(command) {
    this.command = command;
  }

  run() {
    this.runReally().catch(this.exit);
  }

  validate() {
    const [, testFileOrig] = this.command.args;
    if (!testFileOrig || !fs.existsSync(testFileOrig)) {
      if (testFileOrig) {
        return this.exit(`${path.resolve(testFileOrig)} does not exist`, true);
      }
      return this.exit(1, true);
    }

    if (!runChrome && this.command.coverage) {
      return this.exit('you passed --coverage without also passing --chrome/chromium', true);
    }

    if (this.command.coverage && this.command.coverage !== 'chrome') {
      return this.exit(`unknown value --coverage=${this.command.coverage}`, true);
    }
    return true;
  }

  async runReally() {
    if (!this.validate()) {
      return;
    }

    const [targetOrig, testFileOrig] = this.command.args;
    if (this.command.server) {
      console.log(`[ottr] starting server ${this.command.server}`);
      run('ottr:server', this.command.server, {shell: true}).catch(this.exit);
      // TODO: wait for server to be up. maybe request /health?
    }

    await packageForBrowser(testFileOrig);

    const targetUrl = targetOrig.includes('://') ? targetOrig : `http://${targetOrig}`;
    const url = await startOttrServer(targetUrl);

    const useChrome = this.command.chrome || this.command.chromium;
    if (useChrome) {
      const sessionUrl = `${url}/session/${createSession()}`;
      console.log(`[ottr] starting Chrome headless => ${sessionUrl}`);
      // TODO: only import puppeteer if user wants this feature
      this.chrome = new ChromeRunner(
        this.exit,
        sessionUrl,
        !this.command.inspect,
        this.command.coverage === 'chrome',
        this.command.chromium
      );
    }

    if (!this.command.debug) {
      this.exitWhenAllSessionsComplete().catch(this.exit);
    }
  }

  async exitWhenAllSessionsComplete() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const sess = getSessions();
      if (sess.length > 0 && sess.every(s => s.done)) {
        sess.forEach(this.printSessionSummary);
        return this.exit(sess.some(s => s.error) ? 1 : 0);
      }
      await sleep(100);
    }
  }

  exit = async (codeOrError, printHelp?) => {
    let code;
    if (typeof codeOrError === 'number') {
      code = codeOrError;
    } else {
      console.error('[ottr] initialization failed', codeOrError);
      code = 1;
    }
    if (this.chrome) {
      try {
        await this.chrome.finish();
      } catch (e) {
        console.error('[ottr] error shutting down Chrome', e);
      }
    }
    if (printHelp) {
      this.command.help();
    }
    process.exit(code);
  };

  printSessionSummary = s => {
    const tests = s.getTests();
    if (s.error) {
      const failed = tests.filter(t => t.error);
      if (failed.length > 0) {
        console.error(`[ottr] failed: ${failed.length} of ${tests.length}`);
      }
      if (s.error !== DEFAULT_ERROR) {
        console.error(`[ottr] failed: ${s.error || 'unknown error'}`);
      }
    } else {
      console.log(`[ottr] success! ${tests.length} tests passed`);
    }
  };
}

const args = commander
  .description(
    `  url:  the website to run your tests against
    file: root end-to-end test file that runs all your tests`
  )
  .arguments('<url> <file>')
  .option('-s, --server <cmd>', "command ottr uses to launch your server, e.g. 'npm run watch'")
  .option('-c, --chrome', 'opens headless Chrome/Chromium to the ottr UI to run your tests')
  .option('--chromium <path>', 'uses the specified Chrome/Chromium binary to run your tests')
  .option('--coverage <type>', "use 'chrome' for code coverage from Chrome DevTools (see below)")
  .option('-d, --debug', 'keep ottr running indefinitely after tests finish')
  .option('-i, --inspect', 'runs Chrome in GUI mode so you can watch tests run interactively')
  .on('--help', () =>
    console.log(`
  Examples:

    $ ottr --chrome --debug localhost:9999 src/test/e2e.js

        Runs your tests in e2e.js against your local development server using
        a headless Chrome browser. The --debug option leaves ottr running so
        you can debug interactively using the browser of your choice. (Your
        server must already be running on port 9999.)

    $ nyc --reporter=html ottr --coverage=chrome https://google.com dist-test/e2e.js

        Runs your tests against Google's home page, in a Chrome headless 
        browser, with Chrome's built-in code coverage recording. nyc (the 
        istanbul command-line tool) generates an HTML coverage report.
`)
  )
  .parse(process.argv);

new Ottr(args).run();
