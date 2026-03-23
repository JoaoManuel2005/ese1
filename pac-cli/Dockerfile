FROM --platform=linux/amd64 mcr.microsoft.com/dotnet/sdk:8.0
ENV PATH="${PATH}:/root/.dotnet/tools"
RUN dotnet tool install --global Microsoft.PowerApps.CLI.Tool --version 1.31.6
WORKDIR /pac-workspace
CMD ["tail", "-f", "/dev/null"]
