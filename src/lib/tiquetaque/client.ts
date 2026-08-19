// Fachada de compatibilidade.
//
// A implementacao mudou de lugar: transporte (auth, retentativa de 429,
// paginacao, erros tipados) esta em http.ts e os wrappers por recurso em
// resources.ts. Este arquivo continua existindo — e continua sendo um alvo
// de import valido — porque as telas, as server actions e a rota de cron
// importam daqui; trocar o caminho em todos eles seria ruido no diff sem
// ganho nenhum.
//
// Codigo NOVO deve importar de resources.ts (wrappers) ou http.ts
// (transporte), que expoem bem mais do que os 5 simbolos abaixo.

export {
  isTiqueTaqueAvailable,
  fetchAllEmployees,
  fetchPaymentSources,
  fetchEmployeeDays,
  fetchEmployeeLeaves,
} from "./resources";
