import { FinanceService } from './core/service';
const service = new FinanceService(process.env.FINANCE_DB);
console.log(`Veritabanı şeması hazır: ${service.databasePath}`);
service.close();
