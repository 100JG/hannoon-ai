import {sqliteTable,text,integer,index,uniqueIndex} from 'drizzle-orm/sqlite-core';
export const quotas=sqliteTable('quotas',{
  day:text('day').notNull(),scope:text('scope').notNull(),used:integer('used').notNull().default(0)
},t=>[uniqueIndex('quota_day_scope').on(t.day,t.scope)]);
export const jobs=sqliteTable('jobs',{
  id:text('id').primaryKey(),owner:text('owner').notNull(),ip_hash:text('ip_hash').notNull(),
  request_id:text('request_id'),source_hash:text('source_hash').notNull(),cap_hash:text('cap_hash').notNull(),
  state:text('state').notNull(),private_state:text('private_state'),result_json:text('result_json'),error:text('error'),
  quota_day:text('quota_day').notNull(),attempts:integer('attempts').notNull().default(0),
  reserved_calls:integer('reserved_calls').notNull().default(6),lease_until:integer('lease_until').notNull().default(0),
  lease_token:text('lease_token'),last_stage:text('last_stage'),created_at:integer('created_at').notNull(),expires_at:integer('expires_at').notNull(),
  session_limit:integer('session_limit').notNull(),ip_limit:integer('ip_limit').notNull(),global_limit:integer('global_limit').notNull(),api_limit:integer('api_limit').notNull()
},t=>[uniqueIndex('owner_request').on(t.owner,t.request_id),index('jobs_expiry').on(t.expires_at),index('jobs_active').on(t.state,t.expires_at)]);
