# Contributing Guide

This document outlines our collaboration practices to ensure a smooth and consistent workflow.

---

## Overview

We follow:

* A **3-branch Git strategy**
* A strict **branch naming convention**
* Strict **branch lifetime management**
* A standardized **commit message format**
* Structured **Issues and Merge Requests (MRs)** using templates
* Guided (but non-mandatory) **code review questions**

Please read this guide before submitting changes.

---

# Branching Strategy

We use a **3-branch model**:

### `main`

* Production-ready code
* Always stable and deployable
* Only updated via merge from `develop`

### `develop`

* Integration branch
* Accumulates completed features before a release
* Target branch for feature and bug merge requests

### Feature Branches

* Created from `develop`
* Used for individual features, bug fixes, or tests
* Merged back into `develop` via Merge Request

### Workflow Summary

1. Create branch from `develop`
2. Implement changes
3. Open Merge Request → target `develop`
4. After release preparation → `develop` merges into `main`

---

# Branch Naming Convention

Branches must follow this format:

```
<type>/<short-type-description>/<issue-id>-<short-description>
```

### Types

* `feature`
* `bug`
* `test`

### Examples

```
test/ci-cd/789-add-auth-service-tests
```

Rules:

* Use lowercase
* Use hyphens for separation
* Keep descriptions concise but meaningful

---

# Branch Lifetimes

Branches have strict lifetimes based on the time estimates agreed upon at the Sprint Planning Meetings. This ensures that we do not have stale branches that cause big merges.

---

# Commit Message Convention

All commits must follow this format:

```
[#issue-id] - useful information
```

### Examples

```
[#123] - Add JWT validation middleware
[#456] - Fix null pointer in payment service
```

Rules:

* Always reference the related issue
* Use imperative tense
* Be descriptive but concise

---

# Issues

We use GitLab Issues for:

* Features
* Bug reports
* Technical tasks
* Improvements

Each issue must:

* Use the provided Issue template
* Clearly describe expected behavior
* Include acceptance criteria when applicable

Every feature branch must be linked to an Issue.

---

# Labels

Issues and Merge Requests should be tagged with GitLab labels to allow for proper issue tracking on the GitLab issue board.

Descriptive labels are used to provide context on issues and are not mandatory, whereas one of the following labels is mandatory for every issue:
- status::todo
- status::doing
- status::done

---


# Merge Requests (MR)

All changes must go through a Merge Request.

Requirements:

* Target branch: `develop`
* Linked Issue
* Use the provided MR template
* Pipeline must pass (if applicable)
* Address review feedback before merging

Avoid:

* Direct commits to `main`
* Direct commits to `develop`

---

# Code Review Guidelines

We use guided (non-mandatory) review questions to improve quality and consistency.

Reviewers may consider:

- Purpose
    - Does this change solve a problem?
    - How would I solve this problem?
    - Has dependent documentation, such as user guides been updated?

- QA
    - What are the typical and extreme cases for use of this code? Are they covered by test cases?
    - Has the developer thought about corner cases (empty collections, parameter boundaries…)?
    - Are the test cases readable and well organised?
    - How does this code handle exceptional situations?

- Architecture
    - Does the change follow the existing architectural convention for the software?
    - Are there missed opportunities for reuse of existing code?
    - Are there clones present in the change?

- Code
    - Do identifiers following project naming conventions? Is there purpose evident?
    - Is the code self-documenting?
    - Are all source comments necessary?

- Non-functional considerations
    - Are performance optimisations possible?
    - Are efficiency optimisations possible?
    - Are relevant security patterns followed?

The goal of review is:

* Knowledge sharing
* Quality improvement
* Risk reduction
* Team alignment

Reviews should be constructive and respectful.

---

#  Release Process

1. `develop` is stabilized
2. Final verification/testing
3. Merge `develop` → `main`
4. Tag release (if applicable)

---

# Deployment Process

A mirrored GitHub repository that the client has access to has been used for deployment. Every commit on the GitLab is mirrored on the GitHub repository.

Merges into `main` on the GitLab trigger a GitHub Actions workflow which builds the Docker containers for the app and saves the images as artifacts which the client can download and run. 

This was the Deployment and Handover method agreed upon with the client.

---

# Collaboration Principles

* Keep PRs small and focused
* Communicate early if blocked
* Prefer clarity over cleverness
* Ask questions when unsure
* Improve the codebase incrementally

