using DotNetEnv;
using Qdrant.Client;
using RagBackend.Services;

// Load .env file (same as Python python-dotenv)
Env.TraversePath().Load();

var builder = WebApplication.CreateBuilder(args);

// ── Configuration ─────────────────────────────────────────────────────────────
// Merge environment variables so IConfiguration picks them up
builder.Configuration.AddEnvironmentVariables();

// ── Services ──────────────────────────────────────────────────────────────────
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
        options.JsonSerializerOptions.PropertyNameCaseInsensitive = true;
    });
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddHttpClient();

// Register Qdrant client
var qdrantHost = builder.Configuration["QDRANT_HOST"] ?? "localhost";
var qdrantPort = int.Parse(builder.Configuration["QDRANT_PORT"] ?? "6334");
builder.Services.AddSingleton(new QdrantClient(qdrantHost, qdrantPort));

// Register app services as singletons so state (vector store, memory) persists
builder.Services.AddSingleton<LlmClientService>();
builder.Services.AddSingleton<ConversationMemoryService>();
builder.Services.AddSingleton<PacParserService>();
builder.Services.AddSingleton<OnnxEmbeddingService>();
builder.Services.AddSingleton<RagPipelineService>();
builder.Services.AddSingleton<SharePointService>();

// CORS — mirror Python CORSMiddleware settings
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy
            .WithOrigins("http://localhost:3000", "http://localhost:5173")
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

// ── Build ─────────────────────────────────────────────────────────────────────
var app = builder.Build();

// Pre-initialize ONNX embedding service to avoid blocking on first request
var onnxService = app.Services.GetRequiredService<OnnxEmbeddingService>();
await onnxService.InitializeAsync();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors();
app.UseAuthorization();
app.MapControllers();

app.Run();
