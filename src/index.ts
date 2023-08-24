import * as Dotenv from "dotenv";
Dotenv.config();
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import YAML from 'yaml';
import fs from 'fs';
import path from 'path';
import { MonitorFailureResult } from "./models/result";
import { destroy } from "./models/db";
import { emitAndPersistResults, execute } from "./exec";
import { initLocaleAndTimezone } from "./lib/utility";

(async () => {
    const args = await getArgs();
    const logger = log.bind(args);
    let exitCode = 0;
    try {
        const config = getConfig(args, logger);
        logger(`starting ${args.eval} evaluator`);
        await execute(
            config,
            args.eval,
            logger);
    } catch(err) {
        logger(err, err);
        // emits a global config error - assume Sumo monitor is set up for this
        const result = new MonitorFailureResult(
            "watchdog",
            "configuration",
            err.message,
            null); // nothing we can do about this - digest will not be configured
        await emitAndPersistResults([result]);
        exitCode = -1;
    } finally {
        await destroy();
    }
    process.exit(exitCode);
})();

function getFileNamePart(fileName: string) {
    const parts = fileName.split(/[\\\/]+/);
    const nameParts = parts[parts.length - 1].split(".");
    nameParts.pop();
    return nameParts.join(".");
}

function getConfigFileInfo(file) {
    const yamlFileName = file.toLowerCase().endsWith(".yaml") ? file : `${ file }.yaml`;
    const filePath = path.join(path.dirname(''), yamlFileName);
    const fileName = getFileNamePart(yamlFileName);
    return {
        filePath,
        fileName
    }
}

function getAndValidateConfigFileInfo(fileName, log) {
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

function getConfigurationFromFile(file, fileInfo: { fileName: string; filePath: string }, log) {
    try {
        return YAML.parse(file);
    } catch (err) {
        const error = `invalid yaml definition in file '${ fileInfo.filePath }'`;
        log(`error: ${ error }`);
        err.message = `${ error } - ${ err.message }}`;
        throw err;
    }
}

function getConfig(args, log) {
    const { file, fileInfo } = getAndValidateConfigFileInfo(args.env, log);
    const env = getConfigurationFromFile(file, fileInfo, log);
    if (env.config) {
        initLocaleAndTimezone(env.config);
    }
    return {
        fileName: fileInfo.fileName,
        ...args,
        env: getConfigurationFromFile(file, fileInfo, log),
        digest: getDigestConfiguration(args, log)
    };
}

function getDigestConfiguration(args, log) {
    if (!args.digest) {
        return null;
    }
    const { file, fileInfo } = getAndValidateConfigFileInfo(args.digest, log);
    const config = getConfigurationFromFile(file, fileInfo, log);
    config.title ??= args.title ?? "";
    return config;
}

function log(msg, data) {
    if (this.debug) {
        data
            ? console.log(msg, data)
            : console.log(msg);
    }
}

async function getArgs() {
    const args = await yargs(hideBin(process.argv))
        .usage("$0 --eval=<eval> --env=<env> --digest=<digest> --title=<title> --<debug>")
        .command(
            "--eval=<eval> --env=<env> --digest=<digest> --title=<title>",
            "starts the relevant evaluator defined by <eval> for the configuration defined in <env>.yaml",
        )
        .option("eval", {
            description: "Comma separated list of evaluators to run",
            type: "string",
        })
        .option("env", {
            description: "The path to the yaml configuration file to use",
            type: "string"
        })
        .option("digest", {
            description: "If set, the results will be processed with configured digest file",
            type: "string"
        })
        .option("title", {
            description: "When set, is used in notifications using variable {{ title }}",
            type: "string"
        })
        .example("$0 --env=client", "→ run all evaluators using ./client.yaml")
        .example("$0 --eval=mysql --env=client", "→ runs the mysql evaluator only")
        .example("$0 --eval=web,mysql --env=client", "→ runs the mysql & web evaluators only")
        .demandOption("env")
        .help("h")
        .alias("h", "help")
        .argv;
    return args;
}
