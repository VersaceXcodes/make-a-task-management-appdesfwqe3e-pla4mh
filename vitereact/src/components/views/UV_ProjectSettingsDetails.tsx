import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Trash2, AlertTriangle } from 'lucide-react';

/**
 * UV_ProjectSettingsDetails Component
 * 
 * Allows project administrators to view and modify project settings
 * including project name, description, visibility, and other configurations.
 */
const UV_ProjectSettingsDetails: React.FC = () => {
    const { project_key } = useParams<{ project_key: string }>();
    const [isLoading, setIsLoading] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    // Mock project data - in a real app, this would come from an API or store
    const [projectSettings, setProjectSettings] = useState({
        name: 'Sample Project',
        key: project_key || 'SMPL',
        description: 'This is a sample project for task management.',
        visibility: 'private',
        category: 'software',
        defaultAssignee: 'unassigned',
        issueTypes: ['Task', 'Bug', 'Story'],
        createdDate: '2023-01-15',
        owner: 'John Doe'
    });

    const handleSaveSettings = async () => {
        setIsLoading(true);
        try {
            // TODO: Implement API call to save project settings
            await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate API call
            console.log('Project settings saved:', projectSettings);
        } catch (error) {
            console.error('Error saving project settings:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteProject = () => {
        // TODO: Implement project deletion
        console.log('Deleting project:', project_key);
        setShowDeleteConfirm(false);
    };

    const handleInputChange = (field: string, value: string) => {
        setProjectSettings(prev => ({
            ...prev,
            [field]: value
        }));
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900">Project Settings</h1>
                <p className="text-gray-600 mt-2">
                    Configure project details and preferences for {projectSettings.name} ({projectSettings.key})
                </p>
            </div>

            {/* General Settings Card */}
            <Card>
                <CardHeader>
                    <CardTitle>General Settings</CardTitle>
                    <CardDescription>
                        Basic project information and configuration
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="project-name">Project Name</Label>
                            <Input
                                id="project-name"
                                type="text"
                                value={projectSettings.name}
                                onChange={(e) => handleInputChange('name', e.target.value)}
                                placeholder="Enter project name"
                            />
                        </div>
                        
                        <div className="space-y-2">
                            <Label htmlFor="project-key">Project Key</Label>
                            <Input
                                id="project-key"
                                type="text"
                                value={projectSettings.key}
                                onChange={(e) => handleInputChange('key', e.target.value.toUpperCase())}
                                placeholder="PROJ"
                                maxLength={10}
                            />
                            <p className="text-xs text-gray-500">
                                Used as prefix for issue keys (e.g., {projectSettings.key}-1)
                            </p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="project-description">Description</Label>
                        <Textarea
                            id="project-description"
                            value={projectSettings.description}
                            onChange={(e) => handleInputChange('description', e.target.value)}
                            placeholder="Describe what this project is about..."
                            rows={4}
                        />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="project-visibility">Visibility</Label>
                            <Select 
                                value={projectSettings.visibility} 
                                onValueChange={(value) => handleInputChange('visibility', value)}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select visibility" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="private">Private</SelectItem>
                                    <SelectItem value="public">Public</SelectItem>
                                    <SelectItem value="internal">Internal</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="project-category">Category</Label>
                            <Select 
                                value={projectSettings.category} 
                                onValueChange={(value) => handleInputChange('category', value)}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select category" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="software">Software Development</SelectItem>
                                    <SelectItem value="marketing">Marketing</SelectItem>
                                    <SelectItem value="design">Design</SelectItem>
                                    <SelectItem value="research">Research</SelectItem>
                                    <SelectItem value="other">Other</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="default-assignee">Default Assignee</Label>
                        <Select 
                            value={projectSettings.defaultAssignee} 
                            onValueChange={(value) => handleInputChange('defaultAssignee', value)}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select default assignee" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="unassigned">Unassigned</SelectItem>
                                <SelectItem value="project-lead">Project Lead</SelectItem>
                                <SelectItem value="reporter">Issue Reporter</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            {/* Project Information Card */}
            <Card>
                <CardHeader>
                    <CardTitle>Project Information</CardTitle>
                    <CardDescription>
                        Read-only project details
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <Label className="text-sm font-medium text-gray-500">Project Owner</Label>
                            <p className="text-sm text-gray-900 mt-1">{projectSettings.owner}</p>
                        </div>
                        
                        <div>
                            <Label className="text-sm font-medium text-gray-500">Created Date</Label>
                            <p className="text-sm text-gray-900 mt-1">
                                {new Date(projectSettings.createdDate).toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                })}
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Danger Zone Card */}
            <Card className="border-red-200">
                <CardHeader>
                    <CardTitle className="text-red-700 flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5" />
                        Danger Zone
                    </CardTitle>
                    <CardDescription>
                        Irreversible and destructive actions
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {!showDeleteConfirm ? (
                        <Button 
                            variant="destructive" 
                            onClick={() => setShowDeleteConfirm(true)}
                            className="flex items-center gap-2"
                        >
                            <Trash2 className="h-4 w-4" />
                            Delete Project
                        </Button>
                    ) : (
                        <Alert className="border-red-200 bg-red-50">
                            <AlertTriangle className="h-4 w-4 text-red-600" />
                            <AlertDescription>
                                <p className="text-red-800 font-medium mb-3">
                                    Are you sure you want to delete this project?
                                </p>
                                <p className="text-red-700 text-sm mb-4">
                                    This action cannot be undone. All issues, comments, and project data will be permanently deleted.
                                </p>
                                <div className="flex gap-2">
                                    <Button 
                                        variant="destructive" 
                                        size="sm"
                                        onClick={handleDeleteProject}
                                    >
                                        Yes, Delete Project
                                    </Button>
                                    <Button 
                                        variant="outline" 
                                        size="sm"
                                        onClick={() => setShowDeleteConfirm(false)}
                                    >
                                        Cancel
                                    </Button>
                                </div>
                            </AlertDescription>
                        </Alert>
                    )}
                </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="flex justify-end space-x-2 pb-6">
                <Button variant="outline">Cancel</Button>
                <Button onClick={handleSaveSettings} disabled={isLoading}>
                    {isLoading ? 'Saving...' : 'Save Changes'}
                </Button>
            </div>
        </div>
    );
};

export default UV_ProjectSettingsDetails;