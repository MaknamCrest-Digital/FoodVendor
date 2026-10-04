export const dashboardMetrics=[
  {label:"Today's sales",value:'GH₵ 4,860.00',icon:'sales'},
  {label:'Orders',value:'72',icon:'orders'},
  {label:'Average order',value:'GH₵ 67.50',icon:'average'},
  {label:'Expenses',value:'GH₵ 620.00',icon:'expenses'},
] as const;

export const paymentSummary=[['Cash','GH₵ 1,520',31],['MoMo','GH₵ 3,040',63],['Card','GH₵ 300',6]] as const;
export const orderStatus=[['New','8','/orders/'],['Preparing','6','/kitchen/'],['Ready','3','/kitchen/'],['Completed','55','/orders/']] as const;
export const recentOrders=[
  ['#AD-1042','5:42 PM','Takeaway','3 items','MoMo','GH₵ 125','Preparing'],
  ['#AD-1041','5:38 PM','Dine In','2 items','Cash','GH₵ 95','Ready'],
  ['#AD-1040','5:32 PM','Takeaway','4 items','MoMo','GH₵ 180','Completed'],
] as const;
export const topProducts=[['Pork + Yam','26 orders'],['Fried Pork','19'],['Chicken + Yam','14'],['Fried Yam','11'],['Coke','9']] as const;
export const lowStock=[['Takeaway Packs','19 remaining'],['Pepper','5.4 kg'],['Malt','26 bottles']] as const;