import { column, varchar, timestamptz, type TableEntity } from './types.js'
export const predictionEntities:TableEntity[]=[{
  name:'prediction_ingestion_receipts',description:'预测规范化请求摘要与原始回执',primaryKey:['run_id'],
  columns:{run_id:column('uuid',false),request_hash:varchar(64),response:column('jsonb',false),created_at:timestamptz(false,'now')},
  foreignKeys:[{columns:['run_id'],referencesTable:'quant_prediction_runs',referencesColumns:['run_id'],onDelete:'RESTRICT'}],
}]
