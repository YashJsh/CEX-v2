import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { prisma } from "../db.js";
import { authSchema } from "../types/auth-schema.js";
import { createToken } from "../utils/auth.js";
import { sendValidationError } from "../utils/validation.js";

export async function signup(req: Request, res: Response): Promise<void> {
  const parsedBody = authSchema.safeParse(req.body);
  if (!parsedBody.success) {
    sendValidationError(res, parsedBody.error);
    return;
  }
  const { username, password } = parsedBody.data;
  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
      },
    });

    res.status(201).json({
      token: createToken({ userId: user.id }),
      userId: user.id,
      username: user.username,
    });
  } catch {
    res.status(409).json({ error: "username already exists" });
  }
}

export async function signin(req: Request, res: Response): Promise<void> {
  //TODO: Implement signin logic
  const signInBody = req.body;
  const parsedBody = authSchema.safeParse(signInBody);
  if (!parsedBody.data){
    res.status(403).json({error : "Incorrect"});
    return;
  }

  //Check if user exists
  const checkUser = await prisma.user.findUnique({
    where : {   
      username : parsedBody.data?.username
    }
  })

  if (!checkUser){
    res.status(404).json({error : "User Not Found"});
    return;
  }

  //Match the password
  const checkPassword = await bcrypt.compare(parsedBody.data?.password!, checkUser.password);
  if (!checkPassword){
    res.status(403).json({
      error : "Invalid Password"
    })
    return;
  }

  res.status(200).json({
    token : createToken({userId : checkUser.id})
  })
}

