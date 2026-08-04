const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const packageJson = require('./package.json');

module.exports = (env, argv) => {
  const isProd = argv.mode === 'production';
  return {
    entry: './src/index.tsx',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: isProd ? '[name].[contenthash].js' : '[name].js',
      publicPath: '/',
      clean: true,
    },
    resolve: {
      extensions: ['.ts', '.tsx', '.js'],
      alias: { '~': path.resolve(__dirname, 'src') },
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          loader: 'ts-loader',
          exclude: /node_modules/,
          options: { transpileOnly: true },
        },
        { test: /\.css$/, use: ['style-loader', 'css-loader'] },
        { test: /\.(woff2?|ttf|eot|svg|png|jpg|gif)$/, type: 'asset/resource' },
      ],
    },
    plugins: [
      new webpack.DefinePlugin({
        __APP_VERSION__: JSON.stringify(packageJson.version),
      }),
      new HtmlWebpackPlugin({ template: './public/index.html' }),
      new MonacoWebpackPlugin({ languages: ['yaml', 'json'] }),
    ],
    devtool: isProd ? 'source-map' : 'eval-cheap-module-source-map',
    devServer: {
      port: 3000,
      historyApiFallback: true,
      proxy: [
        {
          context: ['/api'],
          target: process.env.BFF_URL || 'http://localhost:8080',
          changeOrigin: true,
          ws: true,
        },
      ],
    },
  };
};
