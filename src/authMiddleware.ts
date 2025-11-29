import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthenticatedRequest extends Request {
  user?: any;
}

export const authMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    // Получаем токен из куки
    const token = req.cookies.session;
    
    if (!token) {
      return next(); // Продолжаем без пользователя
    }

    // Верифицируем токен
    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    req.user = decoded;
    
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    next(); // Продолжаем без пользователя в случае ошибки
  }
};