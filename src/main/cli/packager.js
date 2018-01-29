// @flow

import webpack from 'webpack';
import path from 'path';

export const packageForBrowser = (jsEntryPointPath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const folder = path.resolve('.ottr-webpack');
    webpack(
      {
        devtool: 'inline-source-map',
        entry: {
          tests: path.resolve(jsEntryPointPath),
          run: path.resolve(__dirname, '../ui/run-helper.js'),
          ottr: path.resolve(__dirname, '../ui/index.js'),
          repl: path.resolve(__dirname, '../ui/repl-helper.js')
        },
        output: {path: folder, filename: '[name]-bundle.js'},
        resolve: {symlinks: false, alias: {fs: path.resolve(__dirname, 'noop.js')}}
      },
      (err, stats) => {
        const info = stats.toJson();

        if (stats.hasErrors()) {
          console.error(...info.errors);
        }

        if (stats.hasWarnings()) {
          console.warn(...info.warnings);
        }

        if (err || stats.hasErrors()) {
          reject(err);
          return;
        }
        console.log(`[ottr] packaged tests into ${folder}`);
        resolve(folder);
      }
    );
  });
