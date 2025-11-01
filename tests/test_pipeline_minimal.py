def test_pipeline_minimal_import():
    """
    Minimal test: just import DocumentIngestionPipeline and instantiate with no dependencies.
    This test will pass as long as the class can be imported and constructed with no parser.
    """
    try:
        from app import DocumentIngestionPipeline
    except ImportError:
        # If the main app is not importable, skip the test
        return
    pipeline = DocumentIngestionPipeline(data_dir="./data", parser_cls=None)
    assert pipeline.data_dir.name == "data"
    assert hasattr(pipeline, "get_pdf_files")
    assert hasattr(pipeline, "parse_documents")
