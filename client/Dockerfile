FROM node:16.20.2 as build
WORKDIR /client
COPY package*.json . ./
RUN npm install
RUN npm run build
FROM nginx:1.21.3-alpine
COPY --from=build /client/build /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]