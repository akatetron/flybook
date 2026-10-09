// Lets the app import the text-processing code shared with the website (../shared).
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "../shared")];
// The pronunciation dictionary ships as a plain-text asset, read at runtime.
config.resolver.assetExts.push("txt");
module.exports = config;
