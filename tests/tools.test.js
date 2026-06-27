import { jest } from '@jest/globals';

// Set env vars before importing the module
process.env.MR_MCP_GITLAB_TOKEN = 'mock-token';
process.env.MR_MCP_GITLAB_HOST = 'https://gitlab.example.com';

const mockGitlabInstance = {
    Projects: {
        all: jest.fn(),
    },
    MergeRequests: {
        all: jest.fn(),
        show: jest.fn(),
        allDiffs: jest.fn(),
        edit: jest.fn(),
    },
    MergeRequestDiscussions: {
        all: jest.fn(),
        create: jest.fn(),
        addNote: jest.fn(),
    },
    Issues: {
        show: jest.fn(),
    },
    Jobs: {
        all: jest.fn(),
        show: jest.fn(),
    },
    JobArtifacts: {
        downloadArchive: jest.fn(),
    },
};

// Mock the Gitlab library
jest.unstable_mockModule('@gitbeaker/rest', () => ({
    Gitlab: jest.fn(() => mockGitlabInstance),
}));

// Mock the MCP SDK
const registeredTools = new Map();
const mockMcpServerInstance = {
    tool: jest.fn((name, description, schema, handler) => {
        registeredTools.set(name, handler);
    }),
    connect: jest.fn(),
};

jest.unstable_mockModule('@modelcontextprotocol/sdk/server/mcp.js', () => ({
    McpServer: jest.fn(() => mockMcpServerInstance),
}));

jest.unstable_mockModule('@modelcontextprotocol/sdk/server/stdio.js', () => ({
    StdioServerTransport: jest.fn(),
}));

// Import the module under test
await import('../index.js');

describe('GitLab MR MCP Tools', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const getToolHandler = (name) => {
        const handler = registeredTools.get(name);
        if (!handler) {
            throw new Error(`Tool ${name} not found. Available tools: ${Array.from(registeredTools.keys()).join(', ')}`);
        }
        return handler;
    };

    describe('get_projects', () => {
        it('should return a list of projects', async () => {
            const mockProjects = [
                {
                    id: 1,
                    description: 'Test Project',
                    name: 'test-project',
                    path: 'test/project',
                    path_with_namespace: 'group/test-project',
                    web_url: 'https://gitlab.com/group/test-project',
                    default_branch: 'main',
                },
            ];
            mockGitlabInstance.Projects.all.mockResolvedValue(mockProjects);

            const handler = getToolHandler('get_projects');
            const result = await handler({ verbose: false });

            expect(mockGitlabInstance.Projects.all).toHaveBeenCalled();
            const content = JSON.parse(result.content[0].text);
            expect(content).toHaveLength(1);
            expect(content[0].id).toBe(1);
        });

        it('should return raw projects if verbose is true', async () => {
            const mockProjects = [{ id: 1, extra_field: 'hidden' }];
            mockGitlabInstance.Projects.all.mockResolvedValue(mockProjects);

            const handler = getToolHandler('get_projects');
            const result = await handler({ verbose: true });

            const content = JSON.parse(result.content[0].text);
            expect(content[0].extra_field).toBe('hidden');
        });
    });

    describe('list_open_merge_requests', () => {
        it('should return open merge requests', async () => {
            const mockMrs = [
                {
                    iid: 1,
                    project_id: 123,
                    title: 'Test MR',
                    description: 'Description',
                    state: 'opened',
                    web_url: 'http://url',
                },
            ];
            mockGitlabInstance.MergeRequests.all.mockResolvedValue(mockMrs);

            const handler = getToolHandler('list_open_merge_requests');
            const result = await handler({ project_id: 123, verbose: false });

            expect(mockGitlabInstance.MergeRequests.all).toHaveBeenCalledWith({ projectId: 123, state: 'opened' });
            const content = JSON.parse(result.content[0].text);
            expect(content).toHaveLength(1);
            expect(content[0].title).toBe('Test MR');
        });
    });

    describe('get_merge_request_details', () => {
        it('should return merge request details', async () => {
            const mockMr = {
                title: 'MR Title',
                description: 'Desc',
                state: 'opened',
                web_url: 'url',
                target_branch: 'main',
                source_branch: 'feat',
                merge_status: 'can_be_merged',
                detailed_merge_status: 'mergeable',
                diff_refs: {},
            };
            mockGitlabInstance.MergeRequests.show.mockResolvedValue(mockMr);

            const handler = getToolHandler('get_merge_request_details');
            const result = await handler({ project_id: 123, merge_request_iid: 1, verbose: false });

            expect(mockGitlabInstance.MergeRequests.show).toHaveBeenCalledWith(123, 1);
            const content = JSON.parse(result.content[0].text);
            expect(content.title).toBe('MR Title');
        });
    });

    describe('add_merge_request_comment', () => {
        it('should create a discussion note', async () => {
            const mockNote = { id: 1, body: 'comment' };
            mockGitlabInstance.MergeRequestDiscussions.create.mockResolvedValue(mockNote);

            const handler = getToolHandler('add_merge_request_comment');
            const result = await handler({ project_id: 123, merge_request_iid: 1, comment: 'test comment' });

            expect(mockGitlabInstance.MergeRequestDiscussions.create).toHaveBeenCalledWith(123, 1, 'test comment');
            const content = JSON.parse(result.content[0].text);
            expect(content.id).toBe(1);
        });
    });

    describe('add_merge_request_diff_comment', () => {
        it('should create a diff comment', async () => {
            const mockDiscussion = { id: 1 };
            mockGitlabInstance.MergeRequestDiscussions.create.mockResolvedValue(mockDiscussion);

            const args = {
                project_id: 123,
                merge_request_iid: 1,
                comment: 'diff comment',
                base_sha: 'base',
                start_sha: 'start',
                head_sha: 'head',
                file_path: 'file.js',
                line_number: '10',
            };

            const handler = getToolHandler('add_merge_request_diff_comment');
            await handler(args);

            expect(mockGitlabInstance.MergeRequestDiscussions.create).toHaveBeenCalledWith(
                123,
                1,
                'diff comment',
                {
                    position: {
                        base_sha: 'base',
                        start_sha: 'start',
                        head_sha: 'head',
                        old_path: 'file.js',
                        new_path: 'file.js',
                        position_type: 'text',
                        new_line: '10',
                    },
                }
            );
        });
    });

    describe('set_merge_request_title', () => {
        it('should update MR title', async () => {
            const mockMr = { iid: 1, title: 'New Title' };
            mockGitlabInstance.MergeRequests.edit.mockResolvedValue(mockMr);

            const handler = getToolHandler('set_merge_request_title');
            const result = await handler({ project_id: 123, merge_request_iid: 1, title: 'New Title' });

            expect(mockGitlabInstance.MergeRequests.edit).toHaveBeenCalledWith(123, 1, { title: 'New Title' });
            const content = JSON.parse(result.content[0].text);
            expect(content.title).toBe('New Title');
        });
    });

    describe('Error Handling', () => {
        it('should return error response when API fails', async () => {
            mockGitlabInstance.Projects.all.mockRejectedValue(new Error('API Error'));

            const handler = getToolHandler('get_projects');
            const result = await handler({ verbose: false });

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('Error: API Error');
        });
    });

    describe('get_pipeline_jobs', () => {
        it('should return pipeline jobs', async () => {
            const mockJobs = [
                { id: 1, name: 'go-test', status: 'success', stage: 'test', allow_failure: false },
                { id: 2, name: 'golangci-lint', status: 'failed', stage: 'test', allow_failure: false },
            ];
            mockGitlabInstance.Jobs.all.mockResolvedValue(mockJobs);

            const handler = getToolHandler('get_pipeline_jobs');
            const result = await handler({ project_id: 123, pipeline_id: 456 });

            expect(mockGitlabInstance.Jobs.all).toHaveBeenCalledWith(123, { pipelineId: 456 });
            const content = JSON.parse(result.content[0].text);
            expect(content).toHaveLength(2);
            expect(content[0].name).toBe('go-test');
        });
    });

    describe('get_job_details', () => {
        it('should return job details with artifacts', async () => {
            const mockJob = {
                id: 1,
                name: 'golangci-lint',
                status: 'success',
                stage: 'test',
                pipeline_id: 456,
                artifacts: [
                    { file_type: 'codequality', filename: 'gl-code-quality-report.json' },
                    { file_type: 'trace', filename: 'job.log' },
                ],
            };
            mockGitlabInstance.Jobs.show.mockResolvedValue(mockJob);

            const handler = getToolHandler('get_job_details');
            const result = await handler({ project_id: 123, job_id: 1 });

            expect(mockGitlabInstance.Jobs.show).toHaveBeenCalledWith(123, 1);
            const content = JSON.parse(result.content[0].text);
            expect(content.name).toBe('golangci-lint');
            expect(content.artifacts).toHaveLength(2);
        });
    });

    describe('get_code_quality_report', () => {
        it('should return code quality report summary', async () => {
            const mockMr = {
                head_pipeline: { id: 456 },
            };
            const mockJobs = [
                { id: 1, name: 'go-test', status: 'success' },
                { id: 2, name: 'golangci-lint', status: 'success' },
            ];
            const mockJobWithCQ = {
                id: 2,
                name: 'golangci-lint',
                artifacts: [
                    { file_type: 'codequality', filename: 'gl-code-quality-report.json' },
                ],
            };
            const mockReport = JSON.stringify([
                { description: 'test issue', check_name: 'gosec', severity: 'blocker', location: { path: 'file.go', lines: { begin: 10 } } },
                { description: 'minor issue', check_name: 'unused', severity: 'minor', location: { path: 'file.go', lines: { begin: 20 } } },
            ]);

            mockGitlabInstance.MergeRequests.show.mockResolvedValue(mockMr);
            mockGitlabInstance.Jobs.all.mockResolvedValue(mockJobs);
            mockGitlabInstance.Jobs.show
                .mockResolvedValueOnce({ artifacts: [] }) // go-test - no codequality
                .mockResolvedValueOnce(mockJobWithCQ); // golangci-lint - has codequality
            mockGitlabInstance.JobArtifacts.downloadArchive.mockResolvedValue(mockReport);

            const handler = getToolHandler('get_code_quality_report');
            const result = await handler({ project_id: 123, merge_request_iid: 1 });

            expect(mockGitlabInstance.JobArtifacts.downloadArchive).toHaveBeenCalledWith(123, {
                jobId: 2,
                artifactPath: 'gl-code-quality-report.json',
            });
            expect(result.content[0].text).toContain('Total issues: 2');
            expect(result.content[0].text).toContain('blocker: 1');
            expect(result.content[0].text).toContain('minor: 1');
        });

        it('should return error when no pipeline exists', async () => {
            mockGitlabInstance.MergeRequests.show.mockResolvedValue({});

            const handler = getToolHandler('get_code_quality_report');
            const result = await handler({ project_id: 123, merge_request_iid: 1 });

            expect(result.content[0].text).toContain('No pipeline found');
        });

        it('should return error when no codequality artifact found', async () => {
            const mockMr = { head_pipeline: { id: 456 } };
            const mockJobs = [{ id: 1, name: 'go-test', status: 'success' }];

            mockGitlabInstance.MergeRequests.show.mockResolvedValue(mockMr);
            mockGitlabInstance.Jobs.all.mockResolvedValue(mockJobs);
            mockGitlabInstance.Jobs.show.mockResolvedValue({ artifacts: [] });

            const handler = getToolHandler('get_code_quality_report');
            const result = await handler({ project_id: 123, merge_request_iid: 1 });

            expect(result.content[0].text).toContain('No job with codequality artifact found');
        });
    });

    describe('get_test_report', () => {
        it('should return test report summary', async () => {
            const mockMr = {
                head_pipeline: { id: 456 },
            };
            const mockJobs = [
                { id: 1, name: 'golangci-lint', status: 'success' },
                { id: 2, name: 'go-test', status: 'failed' },
            ];
            const mockJobWithJunit = {
                id: 2,
                name: 'go-test',
                artifacts: [
                    { file_type: 'junit', filename: 'junit.xml.gz' },
                    { file_type: 'trace', filename: 'job.log' },
                ],
            };

            // Create a minimal zip with junit-report.xml
            const junitXml = `<?xml version="1.0"?>
<testsuites tests="100" failures="2" errors="0" time="45.5">
  <testsuite tests="10" failures="1" errors="0" time="5.0" name="pkg/a">
    <testcase name="TestGood" classname="pkg/a"/>
    <testcase name="TestBad" classname="pkg/a">
      <failure message="expected 1 got 2">TestBad failed</failure>
    </testcase>
  </testsuite>
  <testsuite tests="90" failures="1" errors="0" time="40.5" name="pkg/b">
    <testcase name="TestAlsoBad" classname="pkg/b">
      <failure message="panic">panic: nil pointer</failure>
    </testcase>
  </testsuite>
</testsuites>`;

            // Minimal zip: PK header + stored entry
            const zipBuffer = Buffer.alloc(30 + 4 + 16 + junitXml.length);
            const sig = 0x04034b50;
            zipBuffer.writeUInt32LE(sig, 0);
            zipBuffer.writeUInt16LE(20, 4); // version
            zipBuffer.writeUInt16LE(0, 8);  // method = stored
            zipBuffer.writeUInt16LE(16, 26); // name length
            zipBuffer.writeUInt16LE(0, 28);  // extra length
            zipBuffer.writeUInt32LE(junitXml.length, 30); // comp size
            zipBuffer.writeUInt32LE(junitXml.length, 34); // uncomp size
            zipBuffer.write('junit-report.xml', 34, 'utf8');
            zipBuffer.write(junitXml, 34 + 16, 'utf8');

            mockGitlabInstance.MergeRequests.show.mockResolvedValue(mockMr);
            mockGitlabInstance.Jobs.all.mockResolvedValue(mockJobs);
            mockGitlabInstance.Jobs.show
                .mockResolvedValueOnce({ artifacts: [] }) // golangci-lint - no junit
                .mockResolvedValueOnce(mockJobWithJunit); // go-test - has junit
            mockGitlabInstance.JobArtifacts.downloadArchive.mockResolvedValue(zipBuffer);

            const handler = getToolHandler('get_test_report');
            const result = await handler({ project_id: 123, merge_request_iid: 1 });

            expect(mockGitlabInstance.JobArtifacts.downloadArchive).toHaveBeenCalledWith(123, {
                jobId: 2,
            });
            expect(result.content[0].text).toContain('Total: tests=100');
            expect(result.content[0].text).toContain('failures=2');
            expect(result.content[0].text).toContain('pkg/a');
            expect(result.content[0].text).toContain('pkg/b');
        });

        it('should return error when no pipeline exists', async () => {
            mockGitlabInstance.MergeRequests.show.mockResolvedValue({});

            const handler = getToolHandler('get_test_report');
            const result = await handler({ project_id: 123, merge_request_iid: 1 });

            expect(result.content[0].text).toContain('No pipeline found');
        });

        it('should return error when no junit artifact found', async () => {
            const mockMr = { head_pipeline: { id: 456 } };
            const mockJobs = [{ id: 1, name: 'lint', status: 'success' }];

            mockGitlabInstance.MergeRequests.show.mockResolvedValue(mockMr);
            mockGitlabInstance.Jobs.all.mockResolvedValue(mockJobs);
            mockGitlabInstance.Jobs.show.mockResolvedValue({
                artifacts: [{ file_type: 'codequality', filename: 'report.json' }],
            });

            const handler = getToolHandler('get_test_report');
            const result = await handler({ project_id: 123, merge_request_iid: 1 });

            expect(result.content[0].text).toContain('No job with junit test artifact found');
        });
    });
});
