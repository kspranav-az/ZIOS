// Public contract of the database module. Everything outside this module must
// import from '@/modules/database' (this file) — never from sibling files.
export { DatabaseModule } from './database.module';
export { DatabaseService, type Queryable } from './database.service';
export {
  TenantContext,
  TenantContextMissingError,
  type TenantContextValue,
} from './tenant-context';
