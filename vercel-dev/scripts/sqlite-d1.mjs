import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';
// Fast in-memory adapter for the core unit tests. Vercel and local preview use libSQL.
export function localDatabase(filename=':memory:'){
 const sqlite=new DatabaseSync(filename);sqlite.exec('PRAGMA foreign_keys=ON');
 sqlite.exec('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)');
 for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())if(!sqlite.prepare('SELECT name FROM local_migrations WHERE name=?').get(file)){sqlite.exec('BEGIN');try{sqlite.exec(readFileSync('drizzle/'+file,'utf8'));sqlite.prepare('INSERT INTO local_migrations VALUES (?)').run(file);sqlite.exec('COMMIT');}catch(error){sqlite.exec('ROLLBACK');throw error;}}
 function prepare(sql){return{sql,values:[],bind(...values){return{...this,values};},async first(){return sqlite.prepare(this.sql).get(...this.values)||null;},async all(){return run(this);},async run(){return run(this);}};}
 function run(statement){const query=sqlite.prepare(statement.sql);if(/^\s*(SELECT|PRAGMA)/i.test(statement.sql))return{results:query.all(...statement.values),meta:{changes:0},success:true};const result=query.run(...statement.values);return{results:[],meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)},success:true};}
 return{prepare,async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const values=statements.map(run);sqlite.exec('COMMIT');return values;}catch(error){sqlite.exec('ROLLBACK');throw error;}},close(){sqlite.close();}};
}
