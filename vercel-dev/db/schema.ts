import { sqliteTable, text, integer, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const materials=sqliteTable('materials',{
 id:text('id').primaryKey(), name:text('name').notNull(), category:text('category').notNull(), brand:text('brand').notNull(), supplier:text('supplier').notNull().default(''), specification:text('specification').notNull().default(''), project:text('project').notNull(), unit:text('unit').notNull(), quantity100:integer('quantity100').notNull(), minimum100:integer('minimum100').notNull(), price100:integer('price100').notNull(), version:integer('version').notNull().default(1), createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull(), createdBy:text('created_by').notNull(), updatedBy:text('updated_by').notNull()
},t=>[check('material_nonnegative',sql`${t.quantity100} >= 0 AND ${t.minimum100} > 0 AND ${t.price100} >= 0`)]);
export const movements=sqliteTable('movements',{
 id:text('id').primaryKey(), materialId:text('material_id').notNull().references(()=>materials.id), type:text('type').notNull(), quantity100:integer('quantity100').notNull(), balance100:integer('balance100').notNull(), note:text('note').notNull(), party:text('party').notNull().default(''), batch:text('batch').notNull().default(''), occurredAt:text('occurred_at').notNull(), recordedAt:text('recorded_at').notNull(), actorId:text('actor_id').notNull(), actorName:text('actor_name').notNull()
},t=>[index('idx_movements_material_recorded').on(t.materialId,t.recordedAt),check('movement_positive',sql`${t.quantity100} > 0`),check('movement_type',sql`${t.type} IN ('received','issued')`)]);
export const audit=sqliteTable('audit',{
 id:text('id').primaryKey(), materialId:text('material_id').notNull().references(()=>materials.id), action:text('action').notNull(), note:text('note').notNull(), beforeJson:text('before_json'), afterJson:text('after_json'), recordedAt:text('recorded_at').notNull(), actorId:text('actor_id').notNull(), actorName:text('actor_name').notNull()
},t=>[index('idx_audit_material_recorded').on(t.materialId,t.recordedAt)]);
export const requests=sqliteTable('requests',{
 id:text('id').primaryKey(), actorId:text('actor_id').notNull(), fingerprint:text('fingerprint').notNull(), responseJson:text('response_json').notNull(), createdAt:text('created_at').notNull()
});

export const users=sqliteTable('users',{
 id:text('id').primaryKey(), username:text('username').notNull().unique(),
 name:text('name').notNull(), role:text('role').notNull(), active:integer('active').notNull().default(1),
 passwordHash:text('password_hash').notNull(), mustChange:integer('must_change').notNull().default(1),
 passwordExpires:integer('password_expires'), authVersion:integer('auth_version').notNull().default(1),
 createdAt:text('created_at').notNull(), updatedAt:text('updated_at').notNull(), lastLogin:text('last_login')
},t=>[check('valid_user_role',sql`${t.role} IN ('admin','staff')`),check('valid_user_active',sql`${t.active} IN (0,1)`)]);
export const sessions=sqliteTable('sessions',{
 tokenHash:text('token_hash').primaryKey(), userId:text('user_id').notNull().references(()=>users.id),
 csrf:text('csrf').notNull(), authVersion:integer('auth_version').notNull(), expiresAt:integer('expires_at').notNull()
},t=>[index('idx_sessions_user').on(t.userId),index('idx_sessions_expiry').on(t.expiresAt)]);
export const authLimits=sqliteTable('auth_limits',{
 key:text('key').primaryKey(), count:integer('count').notNull(), resetAt:integer('reset_at').notNull()
},t=>[index('idx_auth_limits_reset').on(t.resetAt)]);
export const accountAudit=sqliteTable('account_audit',{
 id:text('id').primaryKey(), actorId:text('actor_id').notNull(), userId:text('user_id').notNull(),
 action:text('action').notNull(), recordedAt:text('recorded_at').notNull()
},t=>[index('idx_account_audit_time').on(t.recordedAt)]);
