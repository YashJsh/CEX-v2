import type { Request, Response } from "express";
import {
  orderBodySchema,
  orderIdParamSchema,
  symbolParamSchema,
  updateBalanceSchema,
} from "../types/exchange-schema.js";
import { sendValidationError } from "../utils/validation.js";
import { sendToEngine } from "../utils/engine-client.js";

function getUserId(req: Request): string {
  if (!req.userId) throw new Error("Missing authenticated user");
  return req.userId;
}

export async function addBalance(req : Request, res : Response): Promise<void>{
  const userId = getUserId(req);
  const parsedBody = updateBalanceSchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(res, parsedBody.error);
    return;
  }
  const {amount, symbol} = parsedBody.data;
  const engineResponse = await sendToEngine("update_balance", {
    symbol : symbol, userId : userId, amount : amount
  })
  res.status(engineResponse.ok ? 200 : 400).json(engineResponse.ok ? engineResponse.data : {
    error: engineResponse.error,
  });
}

export async function createOrder(req: Request, res: Response): Promise<void> {
  const userId = getUserId(req);

  const parsedBody = orderBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(res, parsedBody.error);
    return;
  }

  const { type, side, symbol, qty } = parsedBody.data;
  const price = type === "market" ? null : parsedBody.data.price;

  const engineResponse = await sendToEngine("create_order", {
    userId,
    type,
    side,
    symbol,
    price: type === "market" ? null : price,
    qty,
  });

  res.status(engineResponse.ok ? 200 : 400).json(engineResponse.ok ? engineResponse.data : {
    error: engineResponse.error,
  });
}

export async function getDepth(req: Request, res: Response): Promise<void> {
  const parsedParams = symbolParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    sendValidationError(res, parsedParams.error);
    return;
  }

  const { symbol } = parsedParams.data;
  const engineResponse = await sendToEngine("get_depth", { symbol });
  res.status(engineResponse.ok ? 200 : 400).json(engineResponse.ok ? engineResponse.data : {
    error: engineResponse.error,
  });
}

export async function getBalance(req: Request, res: Response): Promise<void> {
  const engineResponse = await sendToEngine("get_user_balance", {
    userId: getUserId(req),
  });

  res.status(engineResponse.ok ? 200 : 400).json(engineResponse.ok ? engineResponse.data : {
    error: engineResponse.error,
  });
}

export async function getOrder(req: Request, res: Response): Promise<void> {
  const parsedParams = orderIdParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    sendValidationError(res, parsedParams.error);
    return;
  }

  const { orderId } = parsedParams.data;
  const engineResponse = await sendToEngine("get_order", {
    userId: getUserId(req),
    orderId,
  });

  res.status(engineResponse.ok ? 200 : 404).json(engineResponse.ok ? engineResponse.data : {
    error: engineResponse.error,
  });
}

export async function cancelOrder(req: Request, res: Response): Promise<void> {
  const parsedParams = orderIdParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    sendValidationError(res, parsedParams.error);
    return;
  }

  const { orderId } = parsedParams.data;
  const engineResponse = await sendToEngine("cancel_order", {
    userId: getUserId(req),
    orderId,
  });

  res.status(engineResponse.ok ? 200 : 400).json(engineResponse.ok ? engineResponse.data : {
    error: engineResponse.error,
  });
}
