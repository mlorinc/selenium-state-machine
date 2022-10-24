import { createLogger, format, transports } from 'winston';
import * as path from 'path';

export const logger = (name: string) => {
    const logger = createLogger({
        level: 'info',
        format: format.combine(
            format.timestamp({
                format: 'YYYY-MM-DD HH:mm:ss'
            }),
            format.errors({ stack: true }),
            format.simple(),
            format.colorize()
        ),
        transports: [
            new transports.File({dirname: path.join('test-resources', 'fsm'), filename: `${name}.log`})
        ]});

    if (process.env.SSM_STDOUT_LOGGING !== undefined) {
        logger.add(new transports.Console({}));
    }

    return logger;
};
