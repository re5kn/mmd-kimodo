# syntax=docker/dockerfile:1
# Single image: ASP.NET Core API (.NET 10) serving the built React frontend.

# ---- frontend build ----
FROM node:22-alpine AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- backend build ----
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS backend
WORKDIR /src/backend
COPY backend/src/MmdKimodo.Core/MmdKimodo.Core.csproj src/MmdKimodo.Core/
COPY backend/src/MmdKimodo.Api/MmdKimodo.Api.csproj src/MmdKimodo.Api/
RUN dotnet restore src/MmdKimodo.Api/MmdKimodo.Api.csproj
COPY backend/src/ src/
RUN dotnet publish src/MmdKimodo.Api/MmdKimodo.Api.csproj -c Release -o /app --no-restore

# ---- runtime ----
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=backend /app ./
COPY --from=frontend /src/frontend/dist ./wwwroot
RUN mkdir -p /data/uploads && chown -R $APP_UID /data
USER $APP_UID
ENV ASPNETCORE_URLS=http://+:8080 \
    Storage__Root=/data/uploads
EXPOSE 8080
ENTRYPOINT ["dotnet", "MmdKimodo.Api.dll"]
