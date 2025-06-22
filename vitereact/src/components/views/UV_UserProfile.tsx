import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAppStore } from '@/store/main';

/**
 * UV_UserProfile Component
 * 
 * Displays and allows editing of user profile information.
 * This includes basic user details, avatar, and account settings.
 */
const UV_UserProfile: React.FC = () => {
    const { authenticated_user } = useAppStore();

    // Mock user data - in a real app, this would come from the store or API
    const userProfile = {
        name: authenticated_user?.name || 'John Doe',
        email: authenticated_user?.email || 'john.doe@example.com',
        avatar: authenticated_user?.avatar || '',
        title: 'Software Developer',
        department: 'Engineering',
        joinDate: '2023-01-15'
    };

    const handleSaveProfile = () => {
        // TODO: Implement profile save functionality
        console.log('Saving profile...');
    };

    const handleChangePassword = () => {
        // TODO: Implement password change functionality
        console.log('Opening change password dialog...');
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900">User Profile</h1>
                <p className="text-gray-600 mt-2">Manage your account settings and preferences</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                {/* Profile Information Card */}
                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle>Profile Information</CardTitle>
                        <CardDescription>
                            Update your personal information and profile details
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {/* Avatar Section */}
                        <div className="flex items-center space-x-4">
                            <Avatar className="h-20 w-20">
                                <AvatarImage src={userProfile.avatar} alt={userProfile.name} />
                                <AvatarFallback className="text-lg">
                                    {userProfile.name.split(' ').map(n => n[0]).join('')}
                                </AvatarFallback>
                            </Avatar>
                            <div>
                                <Button variant="outline" size="sm">
                                    Change Avatar
                                </Button>
                                <p className="text-sm text-gray-500 mt-1">
                                    JPG, GIF or PNG. 1MB max.
                                </p>
                            </div>
                        </div>

                        {/* Form Fields */}
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="name">Full Name</Label>
                                <Input
                                    id="name"
                                    type="text"
                                    defaultValue={userProfile.name}
                                    placeholder="Enter your full name"
                                />
                            </div>
                            
                            <div className="space-y-2">
                                <Label htmlFor="email">Email Address</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    defaultValue={userProfile.email}
                                    placeholder="Enter your email"
                                />
                            </div>
                            
                            <div className="space-y-2">
                                <Label htmlFor="title">Job Title</Label>
                                <Input
                                    id="title"
                                    type="text"
                                    defaultValue={userProfile.title}
                                    placeholder="Enter your job title"
                                />
                            </div>
                            
                            <div className="space-y-2">
                                <Label htmlFor="department">Department</Label>
                                <Input
                                    id="department"
                                    type="text"
                                    defaultValue={userProfile.department}
                                    placeholder="Enter your department"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end space-x-2">
                            <Button variant="outline">Cancel</Button>
                            <Button onClick={handleSaveProfile}>Save Changes</Button>
                        </div>
                    </CardContent>
                </Card>

                {/* Account Security Card */}
                <Card>
                    <CardHeader>
                        <CardTitle>Account Security</CardTitle>
                        <CardDescription>
                            Manage your password and security settings
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label>Password</Label>
                            <p className="text-sm text-gray-500">
                                Last changed 3 months ago
                            </p>
                        </div>
                        
                        <Button 
                            variant="outline" 
                            onClick={handleChangePassword}
                            className="w-full"
                        >
                            Change Password
                        </Button>
                    </CardContent>
                </Card>

                {/* Account Information Card */}
                <Card>
                    <CardHeader>
                        <CardTitle>Account Information</CardTitle>
                        <CardDescription>
                            View your account details
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label>Member Since</Label>
                            <p className="text-sm text-gray-700">
                                {new Date(userProfile.joinDate).toLocaleDateString('en-US', {
                                    year: 'numeric',
                                    month: 'long',
                                    day: 'numeric'
                                })}
                            </p>
                        </div>
                        
                        <div className="space-y-2">
                            <Label>Account Status</Label>
                            <p className="text-sm text-green-600 font-medium">Active</p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default UV_UserProfile;