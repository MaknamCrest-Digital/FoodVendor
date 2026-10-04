import type {PaymentMethod} from '../../src/types/domain';
export const payments: PaymentMethod[] = ['CASH','MOMO','CARD'];
export const paymentLabel=(value:PaymentMethod)=>({CASH:'Cash',MOMO:'MoMo',CARD:'Card'}[value]);
export const icons: Record<string,string>={Pork:'♨',Sides:'◒',Drinks:'◉'};
