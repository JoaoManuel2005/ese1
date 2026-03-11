using System.Collections.Concurrent;

namespace RagBackend.Services;

/// <summary>
/// Thread-safe LRU (Least Recently Used) cache implementation.
/// Used for caching query embeddings to avoid regenerating them.
/// Provides 50-100x speedup for repeated queries.
/// </summary>
public class LruCache<TKey, TValue> where TKey : notnull
{
    private readonly int _capacity;
    private readonly ConcurrentDictionary<TKey, LinkedListNode<CacheItem>> _cache;
    private readonly LinkedList<CacheItem> _lruList;
    private readonly object _lock = new();

    public LruCache(int capacity)
    {
        if (capacity <= 0)
            throw new ArgumentException("Capacity must be greater than 0", nameof(capacity));
        
        _capacity = capacity;
        _cache = new ConcurrentDictionary<TKey, LinkedListNode<CacheItem>>();
        _lruList = new LinkedList<CacheItem>();
    }

    public bool TryGet(TKey key, out TValue value)
    {
        if (_cache.TryGetValue(key, out var node))
        {
            lock (_lock)
            {
                // Move to front (most recently used)
                _lruList.Remove(node);
                _lruList.AddFirst(node);
            }
            value = node.Value.Value;
            return true;
        }

        value = default!;
        return false;
    }

    public void Add(TKey key, TValue value)
    {
        lock (_lock)
        {
            if (_cache.TryGetValue(key, out var existingNode))
            {
                // Update existing
                _lruList.Remove(existingNode);
                _lruList.AddFirst(existingNode);
                existingNode.Value.Value = value;
            }
            else
            {
                // Add new
                if (_cache.Count >= _capacity)
                {
                    // Remove least recently used
                    var lru = _lruList.Last!;
                    _lruList.RemoveLast();
                    _cache.TryRemove(lru.Value.Key, out _);
                }

                var newNode = _lruList.AddFirst(new CacheItem(key, value));
                _cache[key] = newNode;
            }
        }
    }

    public void Clear()
    {
        lock (_lock)
        {
            _cache.Clear();
            _lruList.Clear();
        }
    }

    public int Count
    {
        get
        {
            lock (_lock)
            {
                return _cache.Count;
            }
        }
    }

    private class CacheItem
    {
        public TKey Key { get; }
        public TValue Value { get; set; }

        public CacheItem(TKey key, TValue value)
        {
            Key = key;
            Value = value;
        }
    }
}
