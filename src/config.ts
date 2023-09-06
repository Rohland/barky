import path from "path";
import fs from "fs";
import { log } from "./models/logger";
import YAML from "yaml";
import { initLocaleAndTimezone } from "./lib/utility";
import * as process from "process";
import { EvaluatorType } from "./evaluators/base";

function getFileNamePart(fileName: string) {
    const parts = fileName.split(/[\\\/]+/);
    const nameParts = parts[parts.length - 1].split(".");
    nameParts.pop();
    return nameParts.join(".");
}

function getConfigFileInfo(file) {
    const yamlFilePath = file.toLowerCase().endsWith(".yaml") ? file : `${ file }.yaml`;
    const currentDir = process.cwd();
    const filePath = yamlFilePath.startsWith("/") ? yamlFilePath : path.join(currentDir, yamlFilePath);
    const fileName = getFileNamePart(yamlFilePath);
    return {
        filePath,
        fileName
    }
}

function getAndValidateConfigFileInfo(fileName) {
    let file = null;
    const fileInfo = getConfigFileInfo(fileName);
    try {
        file = fs.readFileSync(fileInfo.filePath, 'utf8');
        if (!file) {
            throw new Error("Empty file");
        }
    } catch {
        const error = `no configuration file found or is empty - please inspect ${ fileInfo.filePath }`;
        log(`error: ${ error }`);
        throw new Error(error);
    }
    return { file, fileInfo };
}

function getConfigurationFromFile(
    file,
    fileInfo: { fileName: string; filePath: string }) {
    try {
        return YAML.parse(file);
    } catch (err) {
        const error = `invalid yaml definition in file '${ fileInfo.filePath }'`;
        log(`error: ${ error }`);
        err.message = `${ error } - ${ err.message }}`;
        throw err;
    }
}

function explodeImports(env, fileInfo: { fileName: string; filePath: any }) {
    if (!Array.isArray(env.import)) {
        return;
    }
    env.import.forEach(x => {
        const dir = path.dirname(fileInfo.filePath);
        const importPath = path.join(dir, x);
        const importConfig = getConfig({ rules: importPath });
        Object.keys(EvaluatorType).forEach(type => {
            if (importConfig.env[type]) {
                env[type] ??= {};
                Object.assign(env[type], importConfig.env[type]);
            }
        })
    });
}

export function getConfig(args) {
    const { file, fileInfo } = getAndValidateConfigFileInfo(args.rules);
    let env = getConfigurationFromFile(file, fileInfo);
    if (env.config) {
        initLocaleAndTimezone(env.config);
    }
    explodeImports(env, fileInfo);
    const digest = getDigestConfiguration(args);
    return {
        fileName: fileInfo.fileName,
        ...args,
        env,
        digest
    };
}

function getDigestConfiguration(args) {
    if (!args.digest) {
        return null;
    }
    const { file, fileInfo } = getAndValidateConfigFileInfo(args.digest);
    const config = getConfigurationFromFile(file, fileInfo);
    config.title ??= args.title ?? "";
    return config;
}
