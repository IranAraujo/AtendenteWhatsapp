import pino from 'pino';

// Define the transport for pretty logging in development
// In production, we typically just use the standard JSON stringifier for Datadog/CloudWatch
const transport = process.env.NODE_ENV === 'development' 
  ? pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    })
  : undefined;

const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    base: {
      env: process.env.NODE_ENV,
    }
  },
  transport as pino.DestinationStream
);

export default logger;
