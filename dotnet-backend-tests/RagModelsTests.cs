using RagBackend.Models;
using Xunit;

namespace RagBackend.Tests;

public class RagModelsTests
{
    [Fact]
    public void RagQueryRequest_Has_Expected_Defaults()
    {
        var req = new RagQueryRequest();
        Assert.Equal(string.Empty, req.Question);
        Assert.Equal(5, req.NResults);
        Assert.Null(req.ApiKey);
        Assert.Null(req.DatasetId);
    }

    [Fact]
    public void RagQueryResponse_Has_Empty_Collections_By_Default()
    {
        var res = new RagQueryResponse();
        Assert.NotNull(res.Sources);
        Assert.Empty(res.Sources);
        Assert.Equal(0, res.ChunksFound);
    }

    [Fact]
    public void RagRetrieveRequest_Has_Expected_Defaults()
    {
        var req = new RagRetrieveRequest();
        Assert.Equal(5, req.NResults);
        Assert.Null(req.FocusFiles);
        Assert.Null(req.ConversationHistory);
    }

    [Fact]
    public void RagRetrieveResponse_Chunks_Is_NotNull()
    {
        var res = new RagRetrieveResponse();
        Assert.NotNull(res.Chunks);
        Assert.Empty(res.Chunks);
    }

    [Fact]
    public void RetrievedChunk_Properties_Can_Be_Set()
    {
        var c = new RetrievedChunk
        {
            Source = "doc.pdf",
            Content = "text",
            Relevance = 0.95
        };
        Assert.Equal("doc.pdf", c.Source);
        Assert.Equal("text", c.Content);
        Assert.Equal(0.95, c.Relevance);
    }

    [Fact]
    public void IngestResponse_Details_Is_NotNull()
    {
        var res = new IngestResponse();
        Assert.NotNull(res.Details);
        Assert.True(res.Success == false);
    }

    [Fact]
    public void ChunkData_Metadata_Is_NotNull()
    {
        var c = new ChunkData();
        Assert.NotNull(c.Metadata);
        Assert.Empty(c.Metadata);
    }

    [Fact]
    public void ChatMessage_Role_Defaults_To_User()
    {
        var m = new ChatMessage();
        Assert.Equal("user", m.Role);
        Assert.Equal(string.Empty, m.Content);
    }

    [Fact]
    public void LocalModelsResponse_Models_Is_NotNull()
    {
        var res = new LocalModelsResponse();
        Assert.NotNull(res.Models);
        Assert.Empty(res.Models);
    }

    [Fact]
    public void ResetRequest_DatasetId_Can_Be_Null()
    {
        var req = new ResetRequest();
        Assert.Null(req.DatasetId);
    }

    [Fact]
    public void DeleteDocsRequest_FileNames_Can_Be_Null()
    {
        var req = new DeleteDocsRequest();
        Assert.Null(req.FileNames);
    }
}
