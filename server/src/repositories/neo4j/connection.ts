import neo4j, { Driver, Session } from 'neo4j-driver';
import { getConfig } from '../../config';
import { getLogger } from '../../utils/logger';

let driver: Driver | null = null;

export function getNeo4jDriver(): Driver {
  if (driver) return driver;
  const config = getConfig();
  driver = neo4j.driver(
    config.neo4j.uri,
    neo4j.auth.basic(config.neo4j.username, config.neo4j.password)
  );
  return driver;
}

export function getSession(): Session {
  return getNeo4jDriver().session({ database: getConfig().neo4j.database });
}

export async function closeNeo4j(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

export async function checkNeo4jConnection(): Promise<boolean> {
  try {
    const session = getSession();
    await session.run('RETURN 1');
    session.close();
    return true;
  } catch (err) {
    getLogger().error(err, 'Neo4j 连接失败');
    return false;
  }
}
