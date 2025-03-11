import { Injectable, LoggerService, Module } from '@nestjs/common';
import { AppController } from './app.controller';

@Injectable()
export class NoOpLogger implements LoggerService {
    log(_message: any, ..._optionalParams: any[]) {
    }

    error(_message: any, ..._optionalParams: any[]) {
    }

    warn(_message: any, ..._optionalParams: any[]) {
    }

    debug?(_message: any, ..._optionalParams: any[]) {
    }

    verbose?(_message: any, ..._optionalParams: any[]) {
    }
}

@Module({
    imports: [],
    controllers: [AppController],
    providers: [],
})
export class AppModule {}
