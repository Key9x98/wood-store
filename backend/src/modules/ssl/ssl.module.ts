import { Resolver } from 'node:dns/promises';
import { env } from '../../config/env';
import { run } from '../../lib/shell';
import { SslService, type DnsAResolver } from './ssl.service';

const resolver = new Resolver();
resolver.setServers(['1.1.1.1', '8.8.8.8']);

const resolveA: DnsAResolver = (domain) => resolver.resolve4(domain);

export const sslService = new SslService({
  serverIp: env.SERVER_IP,
  adminEmail: env.ADMIN_EMAIL,
  runShell: run,
  resolveA,
});
