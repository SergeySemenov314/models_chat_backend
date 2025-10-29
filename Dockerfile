# Backend Dockerfile
FROM node:20-alpine

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package.json
COPY package.json ./

# Устанавливаем зависимости
RUN npm install

# Устанавливаем ts-node и nodemon глобально для development
RUN npm install -g ts-node nodemon

# Копируем исходный код
COPY . .

# Экспонируем порт
EXPOSE 3001

# Команда по умолчанию (будет переопределена в docker-compose)
CMD ["npm", "run", "start:dev"] 