import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';

/**
 * Global on purpose: every bounded context needs the pool, and DatabaseModule
 * owns no feature logic — it is the shared infrastructure module. Module
 * boundaries are still enforced at import level (index.ts only, ADR-0001).
 */
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
