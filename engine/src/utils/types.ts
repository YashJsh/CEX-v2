interface CreateOrderPayload{
    userId : string,
    type : "limit" | "market",
    side : "buy" | "sell"
    symbol : string,
    price: number | null
    qty : number
}

interface GetDepth{
  symbol : string
}

interface GetUserBalance{
  userId : string
}

interface GetOrder{
  userId: string,
  orderId : string,
}

interface CancelOrder{
  userId: string,
  orderId : string,
}

export type { CreateOrderPayload, GetDepth, GetUserBalance, GetOrder, CancelOrder}