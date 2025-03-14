import { Injectable, LoggerService, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { log } from "../models/logger";

@Injectable()
export class DebugLogger implements LoggerService {
    log(message: any, ...optionalParams: any[]) {
        log(message, optionalParams);
    }

    error(message: any, ...optionalParams: any[]) {
        this.log(`error: ${message}`, optionalParams);
    }

    warn(message: any, ...optionalParams: any[]) {
        this.log(`warn: ${message}`, optionalParams);
    }

    debug?(message: any, ...optionalParams: any[]) {
        this.log(`debug: ${message}`, optionalParams);
    }

    verbose?(message: any, ...optionalParams: any[]) {
        this.log(`verbose: ${message}`, optionalParams);
    }
}

@Module({
    imports: [],
    controllers: [AppController],
    providers: [],
})
export class AppModule {}
