# Backend Dockerfile
FROM node:20

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем зависимости и зафиксированные версии
COPY package.json package-lock.json ./

# Устанавливаем зависимости
RUN npm ci

# Устанавливаем ts-node и nodemon глобально для development
RUN npm install -g ts-node nodemon

# Копируем исходный код
COPY . .

# Встроенные документы обязательны для работающего образа.
RUN test -f "seed-documents/Text about AI.docx" && test -f "seed-documents/text about RAG.txt"

# Экспонируем порт
EXPOSE 3001

# Команда по умолчанию (будет переопределена в docker-compose)
CMD ["npm", "run", "start:dev"]
