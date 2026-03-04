using RagBackend.Services;
using Xunit;

namespace RagBackend.Tests;

public class ConversationMemoryServiceTests
{
    [Fact]
    public void AddMessage_Stores_Message_For_Dataset()
    {
        var svc = new ConversationMemoryService(maxMessages: 10);
        svc.AddMessage("ds1", "user", "Hello");
        svc.AddMessage("ds1", "assistant", "Hi there");

        var history = svc.GetHistory("ds1");
        Assert.Equal(2, history.Count);
        Assert.Equal("user", history[0]["role"]);
        Assert.Equal("Hello", history[0]["content"]);
        Assert.Equal("assistant", history[1]["role"]);
        Assert.Equal("Hi there", history[1]["content"]);
    }

    [Fact]
    public void GetHistory_Returns_Empty_For_Unknown_Dataset()
    {
        var svc = new ConversationMemoryService();
        var history = svc.GetHistory("nonexistent");
        Assert.NotNull(history);
        Assert.Empty(history);
    }

    [Fact]
    public void GetHistory_Respects_MaxMessages_Parameter()
    {
        var svc = new ConversationMemoryService(maxMessages: 100);
        for (int i = 0; i < 5; i++)
            svc.AddMessage("ds1", "user", $"msg{i}");

        var history = svc.GetHistory("ds1", maxMessages: 2);
        Assert.Equal(2, history.Count);
        Assert.Equal("msg3", history[0]["content"]);
        Assert.Equal("msg4", history[1]["content"]);
    }

    [Fact]
    public void GetContextSummary_Returns_Empty_For_Unknown_Dataset()
    {
        var svc = new ConversationMemoryService();
        var summary = svc.GetContextSummary("nonexistent");
        Assert.Equal(string.Empty, summary);
    }

    [Fact]
    public void GetContextSummary_Summarizes_Recent_Messages_Within_CharLimit()
    {
        var svc = new ConversationMemoryService();
        svc.AddMessage("ds1", "user", "Short");
        svc.AddMessage("ds1", "assistant", "Reply");

        var summary = svc.GetContextSummary("ds1", maxChars: 500);
        Assert.Contains("user:", summary);
        Assert.Contains("Short", summary);
        Assert.Contains("assistant:", summary);
        Assert.Contains("Reply", summary);
    }

    [Fact]
    public void GetContextSummary_Truncates_To_MaxChars()
    {
        var svc = new ConversationMemoryService();
        svc.AddMessage("ds1", "user", new string('x', 500));

        var summary = svc.GetContextSummary("ds1", maxChars: 50);
        Assert.True(summary.Length <= 50 + 10); // "user: " prefix + some content
    }

    [Fact]
    public void ClearHistory_Removes_All_Messages_For_Dataset()
    {
        var svc = new ConversationMemoryService();
        svc.AddMessage("ds1", "user", "Hello");
        svc.ClearHistory("ds1");

        Assert.Empty(svc.GetHistory("ds1"));
    }

    [Fact]
    public void ClearHistory_Does_Not_Affect_Other_Datasets()
    {
        var svc = new ConversationMemoryService();
        svc.AddMessage("ds1", "user", "One");
        svc.AddMessage("ds2", "user", "Two");
        svc.ClearHistory("ds1");

        Assert.Empty(svc.GetHistory("ds1"));
        Assert.Single(svc.GetHistory("ds2"));
    }

    [Fact]
    public void GetAllDatasets_Returns_All_Registered_Ids()
    {
        var svc = new ConversationMemoryService();
        svc.AddMessage("a", "user", "x");
        svc.AddMessage("b", "user", "y");

        var ids = svc.GetAllDatasets();
        Assert.Equal(2, ids.Count);
        Assert.Contains("a", ids);
        Assert.Contains("b", ids);
    }

    [Fact]
    public void AddMessage_Trims_To_MaxMessages()
    {
        var svc = new ConversationMemoryService(maxMessages: 3);
        svc.AddMessage("ds1", "user", "1");
        svc.AddMessage("ds1", "user", "2");
        svc.AddMessage("ds1", "user", "3");
        svc.AddMessage("ds1", "user", "4");

        var history = svc.GetHistory("ds1");
        Assert.Equal(3, history.Count);
        Assert.Equal("2", history[0]["content"]);
        Assert.Equal("4", history[2]["content"]);
    }
}
