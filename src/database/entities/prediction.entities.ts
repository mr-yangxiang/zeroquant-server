import { column, varchar, timestamptz, type TableEntity } from './types.js'
export const predictionEntities:TableEntity[]=[{
  name:'prediction_ingestion_receipts',description:'预测规范化请求摘要与原始回执',primaryKey:['run_id'],
  columns:{run_id:column('uuid',false),request_hash:varchar(64),response:column('jsonb',false),created_at:timestamptz(false,'now')},
  foreignKeys:[{columns:['run_id'],referencesTable:'quant_prediction_runs',referencesColumns:['run_id'],onDelete:'RESTRICT'}],
}, {
  name:'market_sync_receipts',description:'行情规范化请求与完整原始回执；默认不自动删除',primaryKey:['stock_code','observed_at'],
  columns:{stock_code:varchar(10),observed_at:timestamptz(false),request_hash:varchar(64),response:column('jsonb',false),created_at:timestamptz(false,'now')},
  foreignKeys:[{columns:['stock_code'],referencesTable:'stocks',referencesColumns:['code'],onDelete:'RESTRICT'}],
}, {
  name:'market_sync_watermarks',description:'独立于历史归档的行情观测水位',primaryKey:['stock_code'],
  columns:{stock_code:varchar(10),observed_at:timestamptz(false)},
  foreignKeys:[{columns:['stock_code'],referencesTable:'stocks',referencesColumns:['code'],onDelete:'RESTRICT'}],
}]
