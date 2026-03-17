# Developer Guide

## Table of Contents

- [ClientIds](#clientids)
- [Versioning](#versioning)
- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Security](#security)
- [HTTP Methods](#http-methods)
- [HTTP Response Statuses](#http-response-statuses)
- [Formatting Each Method](#formatting-each-method)
- [Escaping Characters](#escaping-characters)
- [Partial Responses](#partial-responses)
- [Custom Fields](#custom-fields)
- [Pagination](#pagination)
- [Callbacks (Webhooks)](#callbacks-webhooks)
- [Troubleshooting](#troubleshooting)
- [Error Handling](#error-handling)
- [REST SDK Downloads](#rest-sdk-downloads)
- [Document API](#document-api)

---

## ClientIds

### What is a clientId?

A clientId is a unique GUID or Globally Unique Identifier assigned to each integration. This clientId is required for all API calls made by your integration. This will be used to monitor integration performance and systems' health.

### Asked for a clientId?

You should never share your clientId, doing so may result in issues relating to integrations in your environments. A clientId is unique to your company and is used to say that API traffic is coming from your source. It should be treated as a sort of password and identifier for your company. We may disable any clientId that looks to have been compromised if we suspect any abuse.

If anyone asks you to provide a clientId value, do not do so. The only exception to this rule would be integrations where you yourself are creating it. For instance, if you use Zapier and use the Zapier Code function and add your own API call, not in the ConnectWise PSA package. If a tool requires that you enter in the API full path, the body, and request, map it to different things or otherwise is a custom tool that the vendor is not actually developing the calls, you may have to enter your clientId.

Do not provide clientId values to integrations that are designed "out-of-the-box" and apply to all users. An example would be the Automate to ConnectWise PSA integration. That is an integration that is the same for every user and the clientId would be set up by the third-party integration. Automate controls the Ids around that integration themselves.

---

## Versioning

Starting with 2019.1 the API is now tied to the ConnectWise PSA release cycle. Previously the API was versioned as its own entity and followed a format such as `3.0.1`. To provide clarity around the API Versioning and to make it easier for consumers, we have replaced `3.0.0` with the specific ConnectWise PSA version that the API model was released on.

If you develop your API against `2019.1` and pass in the version `2019.1`, you will continue to get the models for `2019.1` even if we change them in `2019.2`. This means that each time we release a breaking change, you have a period of time to switch over to the new version. We do not release new models every release, however you can still target a version that did not have any changes.

> **Example:** In 2019.1 we have a specific ticket model called A. In 2019.4 we update tickets to have model B. If you pass `2019.1`, `2019.2` or `2019.3`, you will get model A, which is 2019.1.

By default all requests will receive the latest version of our API endpoint. As breaking changes are released, each individual API endpoint may receive an updated version. In order to prevent your integration from breaking, we encourage you to request a specific version using an `Accept` header. For all production level integrations we recommend using this Accept header concept, and for all development and testing work, we recommend using the latest version of the API. We will regularly deprecate old models of the API.

### What is a breaking change?

Breaking changes are defined as any change to the APIs that could result in an error being returned by the SDK. The SDK is a JSON interpreter and as long as you develop your code the way a modern JSON interpreter would, you shouldn't have any issues. If you hard code every field, you will have issues that we don't consider breaking.

**Examples of breaking changes:**
- Renaming a field (fixing a typo)
- Changing a field's data type (such as from an int to a decimal, or from editable to read only)
- Changing the response type (such as from an object to an array of objects)
- Validation changes (fields now required that previously were not)

**NOT a breaking change:**
- Adding new fields
- Adding new endpoints
- Making a read only field editable
- Making a field no longer required if it was previously required

As we release breaking changes the individual endpoint will be versioned when applicable. The previous version will be immediately considered deprecated but supported for 12 months. Please note that some endpoints cannot be versioned.

### Formatting Version Header

We use an `Accept` header that lists our JSON schema as well as the version following. Accept headers tell the server what type of information you are expecting to get back.

```
Accept: application/vnd.connectwise.com+json; version=2019.1
```

### Per Endpoint

If you are not ready to update to the latest API Models for your entire integration, you can change your accept header on an endpoint by endpoint basis. We recommend that you keep a singular version across your integration, but will support it either way. Anytime you test your integration and validate it against a version, update your version header even if we are not deprecating the version you are on. We may do so without warning, or give you very little time to make changes.

---

## Authentication

REST based integrations have three methods of authentication:

1. **Recommended:** Using an API Member account to create API Keys specific to the integration.
2. **Impersonation:** Uses either an Integrator Login (Legacy) or another Member to create API Keys programmatically for other members.
3. **Username/Password:** Only supported for internal integrations. Not supported for vendors.

ConnectWise PSA utilizes the "Basic Auth" standard with Public and Private keys and the authorization header that are unique to ConnectWise PSA members. Your header must be base64 encoded and must include a `username:password`. The username will always begin with `CompanyId+` and then use either the public key, integrator username, or MemberId. The password will be the private key, integrator password, or member hash.

**Method 1 - API Keys - Member Authentication** *(Recommended)*
```
Authorization: Basic base64(companyid+publickey:privatekey)
```

**Method 2 - Integrator Login - Impersonation** *(Legacy only)*
```
Authorization: Basic base64(companyid+integratorlogin:integratorpassword)
```

**Method 3 - Member ID and Password - Cookie Authentication** *(Not intended for 3rd party products unless using Hosted API)*
```
Cookie: companyName=YourLoginCompany
Cookie: memberHash=Generated by POST to login.aspx or via Hosted API
Cookie: memberId=YourUsername
Cookie: memberContext=web
```

> **Important:** SSL is required on production PSA servers when accessing the API. Any calls received via regular HTTP will be denied on production systems.

Are you connecting to the Cloud or Staging? If so you must include `API-` in front of the ConnectWise PSA site:

- `api-au.myconnectwise.net`
- `api-eu.myconnectwise.net`
- `api-na.myconnectwise.net`
- `api-staging.connectwisedev.com`

Otherwise you will run into this error:

```json
{
  "code": "Security",
  "message": "SSL is required.",
  "errors": null
}
```

### Obtaining your Keys

We only support API Member and My Account based authentication for Integration Vendors. Impersonation and Cookie Authentication are for internal only based integrations. In rare cases impersonation may be the route to go.

- API Member Only *(Recommended for 3rd parties)*
- Member Impersonation
- My Account
- Cookie Authentication

---

## Rate Limiting

To strengthen the stability, security, and performance of our APIs, reasonable rate limits are enforced. This measure safeguards our system against excessive or unintended high-volume requests. The service monitors resource usage in real time. If your request volume approaches capacity limits, you may receive **HTTP 429 (Too Many Requests)** responses, indicating temporary throttling. These responses include a `Retry-After` header specifying the number of seconds to wait before re-attempting your request. If your integration currently sends over 1,000 requests per minute, it will likely experience rate limiting.

To avoid rate limits:
- Optimize your integration by minimizing unnecessary API calls and using proper filtering
- Limit the number of parallel requests
- Use bundled requests
- Implement intelligent retry mechanisms with exponential backoff
- Respect the `Retry-After` header values

**Example response body:**

```json
{
  "error": "ConnectWiseAPI",
  "message": "Too many requests. Please try again in 30 seconds."
}
```

**Example code for handling 429 response:**

```python
def make_request_with_backoff(url, headers=None, max_retries=5):
    retry_count = 0
    wait_time = 30  # Start with default 30 second wait time
    while retry_count < max_retries:
        response = requests.get(url, headers=headers)
        if response.status_code == 429:  # Too Many Requests
            retry_after = int(response.headers.get("Retry-After", wait_time))  # Use Retry-After if provided
            print(f"Rate limit exceeded. Retrying in {retry_after} seconds...")
            time.sleep(retry_after)  # Wait before retrying
        else:
            return response  # Return successful response or other errors
        retry_count += 1
        wait_time *= 2  # Exponential backoff (30, 60, 120, ...)
    print("Max retries reached. Request failed.")
    return None  # Return None if all retries fail
```

---

## Security

When working with the ConnectWise PSA REST API, security is based on the Security Roles table within Manage. This table determines each type of entity and the level of access associated. We do not recommend requesting Admin access for an integration. Instead, integrators are highly encouraged to only enable the security roles for access that they need.

When looking at the REST API documentation, some items are considered a Setup Table value (denoted with the lock icon). These endpoints will return an inquiry level of access without access to the table.

---

## HTTP Methods

| Method | Description |
|--------|-------------|
| `POST` | Create an entity or any non-CRUD action |
| `GET` | Return entity or list of entities |
| `PUT` | Replace all fields on an entity with supplied fields |
| `PATCH` | Update specific fields on an entity |
| `DELETE` | Remove entity |

---

## HTTP Response Statuses

| Status | Description |
|--------|-------------|
| `201 Created` | The response will be the record that was created as well as the path to it. |
| `204 NoContent` | Will be returned by successful delete requests. |
| `400 Bad Request` | The request could not be understood by the server due to malformed syntax. The client SHOULD NOT repeat the request without modifications. |
| `401 Unauthorized` | The supplied authentication is incorrect. |
| `403 Forbidden` | Improper security role settings for the supplied authentication. |
| `404 Not Found` | Resource URL not found; this could mean the record was deleted or moved. |
| `405 Method Not Allowed` | This will occur if you try to use an HTTP method that is not supported by the URL specified. |
| `409 Conflict` | Record possibly in use or another conflict with the record. |
| `415 Unsupported Media Type` | This can occur when using the documents API if you are sending the file as a JSON object. |
| `429 Too Many Requests` | Request volume exceeds capacity limits. Includes a `Retry-After` header with seconds to wait before retrying. |
| `500 Server Error` | Server errors can occur due to network faults or other non-application-related errors. In some cases, a 500 error may occur when another error message has not been defined. |

> **PSA Specific:** Are you getting a 404 error or "Could not get any response" on cloud? You may have incorrect authentication instead of the resource not being found. To confirm, change your base URL from `v4_6_release` to your ConnectWise PSA version `/201x_x/`.

---

## Formatting Each Method

### Get

Get requests are used for finding both individual records or a listing of records. To grab an individual entity you must specify an id within the request URL:

```
https://api-na.myconnectwise.net/v4_6_release/apis/3.0/service/tickets/5000
```

When requesting a grouping of records, do not include an id. Optionally include parameters to grab a specific set of records:

```
https://api-na.myconnectwise.net/v4_6_release/apis/3.0/service/tickets?conditions=board/name="Integration"%20and%20status/name="new"&page=1&pageSize=10
```

#### URL Max Length

We recommend keeping the URL length of each request to a maximum of **2000 characters**. This will ensure there are no compatibility issues with various servers and configurations. Please keep in mind that the max length of a domain name can reach 255 characters — with that in mind, the safe max length of a URL would be around 1745 characters.

#### Query String Parameters

| Parameter | Description | Example | Operators |
|-----------|-------------|---------|-----------|
| `conditions` | Search results based on the fields returned in a GET | `board/name="Integration"`, `summary="xyz"`, `board/id in (3, 2, 4)`, `lastUpdated > [2016-08-20T18:04:26Z]` | `=`, `!=`, `<`, `<=`, `>`, `>=`, `contains`, `like`, `in`, `not` |
| `childConditions` | Allows searching arrays on endpoints that list childConditions under parameters | `/company/contacts?childconditions=communicationItems/value like "john@Outlook.com" AND communicationItems/communicationType="Email"` | `=`, `!=`, `<`, `<=`, `>`, `>=`, `contains`, `like`, `not` |
| `customFieldConditions` | Allows searching custom fields when customFieldConditions is listed in the parameters | `/company/contacts?customFieldConditions=caption="TomNumber" AND value !=null` | `=`, `!=`, `<`, `<=`, `>`, `>=`, `contains`, `like`, `not` |
| `orderBy` | Choose which field to sort the results by | `contact/name asc` | `asc` or `desc` |
| `fields` | Limits which information is returned in the response | `company/companies?fields=id,name,status/id` | Not available on reporting endpoints |
| `columns` | Limits which information is returned in the response | `system/reports/service?columns=id,summary,name` | Only used for Reporting Endpoints |
| `page` | Used in pagination to cycle through results | | |
| `pageSize` | Number of results returned per page (Defaults to 25) | Max Size = 1,000* | |

*\*Max page size was increased to 1,000 in 2016.2.*

#### Conditions

| Type | Format | Example |
|------|--------|---------|
| Strings | Must be surrounded by quotes | `Summary = "This is my string"` (Accepts `*` for wildcards) |
| Integers | No formatting required | `Board/Id = 123` |
| Boolean | No formatting required, must be `True` or `False` | `ClosedFlag = True` |
| Datetimes | Must be surrounded by square brackets | `LastUpdated = [2016-08-20T18:04:26Z]` |
| Operators | `<`, `<=`, `=`, `!=`, `>`, `>=`, `contains`, `like`, `in`, `not` | `Summary Not Contains "Low Priority"` |
| Logic Operators | `AND`, `OR` | `board/name="integration" and summary="xyz"` |
| Reference | Must have a `/` followed by the field under the reference | `manufacturer/name` |

#### Using the /Search endpoints

If your request URL is going to be over 10,000 characters long, you can use the `/Search` path for certain endpoints. This allows you to enter the conditions in the body of the request:

```http
POST /v4_6_release/apis/3.0/service/tickets/search HTTP/1.1
Host: YOURCONNECTWISESITE
Authorization: Basic AUTHKEY=
Content-Type: application/json

Body:
{
    "conditions": "summary like 'test'"
}
```

Successful GET requests will return a `200` status response and a content body of the record(s).

---

### Patch

Patch requests enable the ability to update individual fields on an entity. The entire object is part of an array and must be surrounded by square brackets:

```
https://api-na.myconnectwise.net/v4_6_release/apis/3.0/service/tickets/5000
```

```json
[
  {
    "op": "string",
    "path": "string",
    "value": "string"
  }
]
```

| Field | Description | Values |
|-------|-------------|--------|
| `op` | The update operation used in the request | `add`, `replace`, `remove` |
| `path` | Pathway for the updated field (Case Sensitive) | `summary`, `company` |
| `value` | The new value if doing a replace | String: `"Here is my Summary"`, Object: `{ "identifier": "connectwise" }` |

> **Note:** When working with custom fields, you must pass the entire array of custom fields.

**Example:**

```json
[
    {
        "op": "replace",
        "path": "summary",
        "value": "New Summary"
    },
    {
        "op": "replace",
        "path": "company",
        "value": {
            "identifier": "New Company"
        }
    },
    {
       "op": "replace",
       "path": "customFields",
       "value": [
            {
                 "id": 5,
                 "caption": "CloudPlus",
                 "type": "Checkbox",
                 "entryMethod": "EntryField",
                 "numberOfDecimals": 0,
                 "value": false
            },
            {
                 "id": 28,
                 "caption": "test",
                 "type": "Text",
                 "entryMethod": "List",
                 "numberOfDecimals": 0,
                 "value": "test"
            }
        ]
    }
]
```

> **Warning:** When updating an Object such as Company, you cannot specify a location inside of the object. You have to replace the whole object. (Do not use `"path":"company/identifier"`). If you try to update the Object incorrectly, you may receive a false `200` message.

Successful patch requests will return a `200` status response for success.

---

### Delete

Delete requests are used for removing records from the ConnectWise PSA system. The id for the record to be deleted needs to be included in the request URL:

```
https://api-na.myconnectwise.net/v4_6_release/apis/3.0/service/tickets/5000
```

Successful delete requests will return a `204` status response for No Content. 204 is a success response.

---

### Post

Post is used when creating new records. The body of the request must be sent in JSON format. When sending a Post, the response body will include the newly created record id as well as a Get request for the record. If you pass a post request without filling out every possible value, the system will attempt to default all required information, and anything that does not require a value will be set to Null.

---

### Put

Put requests are designed to completely replace an entity. They work in the same manner as a Post request with the exception that you must specify an already created entity in your URL. When you use Put to update a record, any field that has not been specified will be overridden with the system defaults or set to Null.

---

## Escaping Characters

When working with JSON, you may find that you need to use characters that require escaping.

**JSON Bodies:**

| Character | Escaped | Displayed in the UI |
|-----------|---------|---------------------|
| Double Quotes | `\"` | `"` |
| Backslash | `\\` | `\` |
| Tab | `\t` | Tabbed space equal to four spaces |
| Backspace *(Not Supported)* | `\b` | An invisible character that doesn't take up any space |
| Carriage Return *(Not Supported)* | `\r` | Single space which is returned as a space in the API |
| Newline *(Not Supported)* | `\n` | Single space which is returned as a space in the API |
| Form Feed *(Not Supported)* | `\f` | An invisible character that doesn't take up any space |

> **Note:** Single quotes `'` do not require escaping in JSON bodies, as they should not be used as a container for your strings. If you are using single quotes around string values, switch to doubles.

**URL Parameters:**

| Character | Formatting |
|-----------|------------|
| `&` | `%26` |
| `"` | `%22` |
| `'` | `%27` |
| `*` | `%2A` |
| `%` | `%25` |
| `+` | `%2B` |
| `[string]` | `[[]string]` |

---

## Partial Responses

The API allows you to specify which information you want to be returned by listing the request fields or columns on your endpoint URL. Partial responses work for both GET and POST requests.

- **Fields:** `company/companies?fields=company/id,company/name,phoneNumber`
- **Columns (Reporting API only):** `system/reports/service?columns=id,summary,company/name`

---

## Custom Fields

Screens that have custom fields in the ConnectWise PSA UI will have an array of fields on the respective endpoint. This array can be both queried and updated via the API. When updating custom fields, you must pass in the entire array object — you cannot patch a single custom field record.

Supported endpoints will have `customFields(CustomFieldValue[])` listed at the end of the documentation.

There are two methods of adding new custom fields:
1. Access the ConnectWise PSA thick client and navigate to **System > Setup Tables > Custom Fields**
2. Use the `system/userDefinedFields` endpoint within the REST API

Searching custom fields uses `customFieldConditions` instead of `conditions`.

### Field Options and Parameters

| Field | Description |
|-------|-------------|
| **Field Caption** | Enter a custom field caption (limited to 12 characters). |
| **Help Text** | Text displayed when hovering over the help button. Limit of 1000 characters (only 512 display on opportunity screen). |
| **Field Type** | Button, Checkbox, Date, Hyperlink, Number, Percent, Text, Text Area |
| **Number of Decimals** | Only available for Number and Percent field types. Up to 5 decimal places. |
| **Method of Entry** | Entry Field, List (Drop-down), Option (Radio) |
| **Sequence #** | Must be between 1 and 50. |
| **Required Field?** | Marks field as required (displayed as blue asterisk). |
| **Display on Screen?** | Whether to display on the Opportunities screen. Selected by default. |
| **Read Only?** | For API use. Required Field checkbox cannot be marked for this field. |
| **Include on List View?** | Include in list view (limit of 10 fields on list view screen). |
| **Button URL** | URL for Button field type. Only appends URLs. |
| **Select Locations** | Required. Opportunities with specified location(s) will display this custom field. |
| **Select Departments** | Optional. Opportunities with specified department(s) will display this custom field. |

---

## Pagination

### Navigable

Most of the time, there is far more information than is needed for integration. In order to ensure server availability, the API automatically sets the page size to 25 results.

| Parameter | Description |
|-----------|-------------|
| `pagesize` | Number of results returned by each call. Default is 25, maximum is 1,000. |
| `page` | Starting with page 1, is the number of pages available based on the current pagesize. |

When using paging, the response will include a `Link` header:

```
link <https://staging.connectwisedev.com/v2017_3/apis/3.0/company/companies?pageSize=50&page=2>; rel="next",
     <https://staging.connectwisedev.com/v2017_3/apis/3.0/company/companies?pageSize=50&page=4>; rel="last"
```

| Link | Description |
|------|-------------|
| `first` | Displays the first page available based on the current page size |
| `prev` | Displays the previous page based on the current page position and page size |
| `next` | Displays the next available page based on the current page position and page size |
| `last` | Always displays the final page available based on the current page size |

> `next` and `prev` links will not be returned if there isn't a next or prev respectively.

Navigable Pagination closely follows [RFC 5988](https://tools.ietf.org/html/rfc5988).

### Forward-Only

*Released in 2018.5*

Unlike Navigable Pagination, forward-only requires that you pass in a `pagination-type` header set to `forward-only`. There is also a new query parameter `pageId` — the record in which you would like to begin paging from.

Key notes:
- If you do not include the new header, it will use the default navigable paging method.
- The `page` query parameter will be ignored with forward-only paging as all results are technically page 1.
- You cannot use an `Order By` query parameter with forward-only as it must be ordered by the ID.
- There will always be a `link` header in the response for the next `pageId`.
- The `pageId` query parameter is treated like an additional condition of `Id > pageId`.
- The following `pageId` in the header will be the last Id you got in the request.

> **Note:** Forward-Only pagination does not work with the Audit Trail endpoints at this time.

---

## Callbacks (Webhooks)

ConnectWise PSA callbacks are payloads of information that are similar to webhooks. When a record is saved within PSA, a summarized payload is sent to a specified location.

### Levels and Types

The REST APIs allow a more granular approach to callbacks. Levels and types open the ability to report on specific boards or tickets without getting unnecessary results.

Supported types include: Activities, Agreements, Companies, Contacts, Configurations, Invoice, Expense, Member, Opportunities, Product Catalog, Projects, Purchase Orders, Schedule Entries, Sites, Tickets, and Time Entries.

### Configuring the Callbacks

More information can be found within the REST API documentation with the endpoint `system/callbacks`.

| Field | Description |
|-------|-------------|
| `Id` | The database record id of the callback; automatically assigned. |
| `Description` | Used to label the callback's usage. |
| `URL` | The URL PSA will send the POST payload to. PSA appends the record id and action to the specified callback URL. |
| `ObjectId` | The Id of whatever record you are subscribing to. Should be set to `1` when using a level of Owner. |
| `Type` | The specific type of record (Company, Ticket, Contact, etc.) |
| `Level` | Determines how granular the callback subscription will be. |
| `MemberId` | Read-only value showing who initially created the Callback. |
| `InactiveFlag` | Used to determine if the callback is active and sending requests. |
| `_Info` | Additional metadata about the record, included on all API requests as read-only data. |

> **Tip:** It is recommended that partners append `&recordId=` to the end of their callback URL to ensure that the record id does not interfere with any custom parameters.
>
> **Example:** Instead of `https://api.mycallbackendpoint.com?param1=5&param2=6`, use `https://api.mycallbackendpoint.com?param1=5&param2=6&recordId=`

**Example POST:**

```json
POST /v4_6_release/apis/3.0/system/callbacks
{
    "id": 0,
    "description": "maxLength = 100",
    "url": "Sample string",
    "objectId": 0,
    "type": "Sample string",
    "level": "Sample string",
    "memberId": 0,
    "inactiveFlag": "false",
    "_info": { "lastUpdated": "", "updatedBy": "" }
}
```

### Testing Callbacks

When testing ConnectWise PSA callbacks, [https://webhook.site](https://webhook.site) is a useful browser-based tool. Simply create a URL and add it as your ConnectWise PSA callback URL:

```
https://webhook.site/xxxxxxx-xxxx-xxxx-af13-855ab85aebae
```

### When Callbacks Fail to POST to Target Host

When a callback receives an error when attempting to POST the payload, ConnectWise PSA will retry the POST for any `404`, `409`, `419`, or `429` error responses. ConnectWise PSA retries twice: once two seconds after the initial POST attempt, and again four seconds after the first retry. Requests will timeout after five seconds.

The system counts how many consecutive days the callback fails, and after **three consecutive days** of failed attempts, ConnectWise PSA will **disable the callback**.

Any `2xx` response is considered successful.

For on-premise instances, callback service logs are found at:
```
C:\Program Files\ConnectWise\ApiCallbackService\logs\server.log
```

To enable verbose logging, change the `minlevel` value to `minlevel="Info"` in:
```
C:\Program Files\ConnectWise\ApiCallbackService\ApiCallbackService.exe.nlog
```

### Verifying the Callback Source

Callbacks contain a `key_url` in the metadata section that can be used to verify the source of the callback. The `key_url` returns the signing key which can be used in conjunction with the `x-content-signature`:

```csharp
using (var sha = new SHA256Managed())
{
    var hash = sha.ComputeHash(Encoding.UTF8.GetBytes(sharedSecretKey));
    using (var hmac = new HMACSHA256(hash))
    {
        return Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(jsonPayload)));
    }
}
```

### Callback Changelog

| Supported Version | Changes |
|-------------------|---------|
| ConnectWise PSA 2020.2 | Added callbacks for Configurations |
| ConnectWise PSA 2016.6 | Added callbacks for Invoice, Projects, and Activities |
| ConnectWise PSA 2016.5 | Company Callbacks: Added Status and Type levels; Contact Callbacks: Added Type level; Ticket Callbacks: Added levels for tracking Project Tickets |
| ConnectWise PSA 2016.4 | Added callbacks for Opportunities |
| ConnectWise PSA 2016.3 | Added callbacks for Companies and Contacts |
| ConnectWise PSA 2015.6 | Added callbacks for Tickets |

---

## Troubleshooting

Troubleshooting with the REST API requires login access to the ConnectWise PSA UI. Additionally, the account being used to login must have access to information relating to the account for integration.

Logging with the REST API must be specifically turned on and there is a time limit of **1440 minutes (24 hours)** that can be recorded in a single session.

To get started with logging, access the **API Log** tab found on every ConnectWise PSA member. Navigate to either **System > Members** or **My Account** and click on the **API Logs** tab.

Once you have found the API Logs tab, press **"Start Debug Mode"** and select the amount of time you would like to record for. Debugging will only run for a maximum of 1440 minutes per queue. You can restart the timer at any time by hitting "Start Debug Mode" again.

### Reading Logs

| Column | Description |
|--------|-------------|
| **Search** | Refreshes the visible logs |
| **Start Debug Mode** | Kicks off the recording process for the specified amount of time |
| **Download Logs** | Provides a shareable document containing all requests recorded since the last time debug mode was started |
| **API Key Description** | The public key associated to the logged API Call |
| **Start Time** | Start time for the request; click to show request body details |
| **Duration (ms)** | How long the request took to be completed in milliseconds |
| **Response** | Shows the HTTP response code returned; error messages/underlined responses can be clicked for further details |
| **Method** | The HTTP verb being used in the request |
| **URL** | The full request endpoint URL being used |

### Telerik's Fiddler

The built-in logging capabilities of Manage are limited in that if you want your request to show up, it must have first been processed by the server. There are other tools that will provide information about your requests.

| Utility | Description | Download |
|---------|-------------|----------|
| Fiddler by Telerik | Free Web Debugging Proxy | https://www.telerik.com/fiddler |

Fiddler must be run from the machine that is making the outbound requests. If you are using Postman, you will also need to go into Postman's Settings and **turn off SSL Certificate Verification**, otherwise Postman will return an error saying it couldn't get a response.

---

## Error Handling

When working with the API, it is important to understand best practices for handling errors. Every error should be properly logged so it can be referenced later on. Server errors are generally considered to be temporary errors and requests should be repeated. When it comes to Client errors, the request should be stopped immediately.

### Retry Policy

An application that communicates with elements running in the cloud has to be resilient against transient faults. These faults include momentary loss of network connectivity, temporary service unavailability, timeouts when services are busy, and rate limiting.

**Design Principles:**
- Distinguish between retryable and non-retryable failures
- Implement intelligent delay strategies
- Respect service-provided backoff instructions
- Apply appropriate limits to prevent excessive retries
- Consider the operation context when configuring retry behavior

**Failure Handling Strategies:**

1. **Cancel** — If the fault indicates that the failure isn't transient or is unlikely to be successful if repeated, cancel the operation. Examples: `401`, `403`, `404`, `400`, and other 4xx errors not identified as retryable.

2. **Retry Immediately** — If the specific fault is unusual or rare (e.g., corrupted network packet), an immediate retry might be appropriate.

3. **Retry with Exponential Backoff** — For common connectivity issues or busy services:
   - Start with a base delay (e.g., 100ms)
   - For each subsequent retry, multiply the previous delay by a constant factor (typically 2)
   - Apply a maximum delay cap
   - Add jitter (randomization) to prevent retry storms

4. **Retry with Service-Guided Backoff** — For `HTTP 429` responses, parse and respect the `Retry-After` header. Fall back to exponential backoff if not provided.

**Implementation Pattern:**

```
Initialize retry policy with:
  - Maximum retry attempts
  - Base delay duration
  - Backoff multiplier
  - Maximum delay cap
  - Jitter factor

For each operation:
  retries = 0
  DO
    Try to execute the operation
    IF operation succeeds
      Return success
    ELSE IF operation fails with HTTP 429 AND Retry-After header exists
      delay = Parse Retry-After header value
    ELSE IF operation fails with retryable error
      delay = baseDelay * (backoffMultiplier^retries) * (1 ± jitterFactor)
      delay = min(delay, maxDelay)
    ELSE
      Return failure (non-retryable error)
    END IF

    IF retries >= maxRetries
      Return failure (retry limit exceeded)
    END IF

    Wait for calculated delay
    retries = retries + 1
  WHILE retries < maxRetries
```

**Configuring Retry Policies:**

| Application Type | Retry Attempts | Base Delay | Max Delay Cap |
|------------------|---------------|------------|---------------|
| Interactive | 2–3 | 50–100ms | 2–5 seconds |
| Background | 5–10+ | 200–500ms | 30–60 seconds |
| Critical | Combine with circuit breakers | — | — |

### 500 Server Errors

Numerous components on a network can generate errors. The usual technique for dealing with these in a networked environment is to implement retries in the client application. This technique increases the reliability of the application and reduces operational costs.

### 400 Client Errors

A 400 error means that the request isn't valid. Stop the requests and analyze the results in order to resolve the issue. **Do not attempt to retry the request.**

---

## REST SDK Downloads

For more information please visit our SDK Section.

---

## Document API

When working with the Document API, please use the uploaded sample provided with the following endpoint to proceed with testing:

```
GET https://ConnectWiseSite/v4_6_release.../uploadsample
```

The response is an HTML template that shows each of the settings that can be selected. This form should help to design your own code and mimic functionality.

### Calling Company Info

```
"https://" + ConnectWiseSite + "/login/companyinfo/" + LoginCompanyId
```

**Example:**
```
https://na.myconnectwise.net/login/companyinfo/connectwise
```

**Response:**

```json
{
   "CompanyName": "ConnectWise",
   "Codebase": "v2017_3/",
   "VersionCode": "v2017.3",
   "VersionNumber": "v4.6.38842",
   "CompanyID": "CW",
   "IsCloud": "True"
}
```

### API Request URL Format

```
"https://" + ConnectWiseSite + "/" + codebase + "apis/3.0/company/companies"
```

**Example:**
```
https://api-my.myconnectwise.net/v2017_3/apis/3.0/company/companies
```

### Cloud vs Premise

A cloud environment will return a codebase with the PSA version. On-Premise does not use URL redirection and will return `v4_6_release/`. If your returned codebase contains anything other than `v4_6_release/`, you will need to ensure your request is prefixed by `API-`.

### Cloud URLs

The most commonly used URLs for the cloud:

- `https://na.myconnectwise.net`
- `https://eu.myconnectwise.net`
- `https://au.myconnectwise.net`
- `https://aus.myconnectwise.net`
- `https://za.myconnectwise.net`
- `https://staging.connectwisedev.com`
